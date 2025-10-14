// POST /api/auth/discord/unlink - Disconnect Discord and revert to ephemeral identity
// Allows users to unlink their Discord account and go back to ephemeral guest mode

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { requireSessionId } from '../../_shared/session.js'
import { checkSessionRateLimit } from '../../../src/server/rate-limit.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError } from '../../_shared/errors.js'
import { computeIdentityPayload } from '../../_shared/identity.js'

interface UnlinkResponse {
  ok: boolean
  identity: {
    isDiscordLinked: boolean
    isWalletLinked: boolean
    displayLabel: string
    ephemeralName: string
    avatarUrl: string | null
    userId: string
    discord: null
  }
}

async function discordUnlinkHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    throw httpError.badRequest('Method not allowed', 'Only POST requests are supported')
  }

  // Check feature flag
  const allowUnlink = process.env.ALLOW_DISCORD_UNLINK !== 'false' // Default true
  if (!allowUnlink) {
    throw httpError.notFound('Feature not available', 'Discord unlink is currently disabled')
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  // Get session ID from cookie - throws if missing
  let sessionId: string
  try {
    sessionId = requireSessionId(req)
  } catch (error) {
    // Session missing or invalid - return 401
    logger.warn('Unlink attempted without valid session', { correlationId })
    throw httpError.unauthorized('You are not signed in', 'Please reconnect Discord and try again')
  }

  logger.request('/api/auth/discord/unlink', {
    correlationId,
    sessionId
  })

  // Get current user from session
  const { data: presence, error: presenceError } = await supabaseAdmin
    .from('presence')
    .select('user_id, users!inner(id, display_name, ephemeral_display_name, ephemeral)')
    .eq('session_id', sessionId)
    .single()

  if (presenceError || !presence) {
    logger.warn('Session not found in presence table for Discord unlink', { correlationId, sessionId })
    throw httpError.unauthorized('Session expired', 'Please refresh the page and try again')
  }

  const currentUser = presence.users as any
  const userId = currentUser.id

  logger.debug('Discord unlink request', {
    correlationId,
    userId,
    displayName: currentUser.display_name
  })

  // Rate limit: max 5 unlinks per hour per user
  const unlinkRateLimit = parseInt(process.env.UNLINK_RATE_LIMIT_PER_HOUR || '5', 10)
  const rateLimitResult = checkSessionRateLimit(userId, 'discord-unlink', {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: unlinkRateLimit
  })

  if (!rateLimitResult.allowed) {
    logger.warn('Discord unlink rate limit exceeded', {
      correlationId,
      sessionId,
      userId
    })
    throw httpError.tooManyRequests(
      'Too many unlink attempts',
      `Please wait ${Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000 / 60)} minutes before trying again`
    )
  }

  // Check if Discord is actually linked
  const { data: discordAccount } = await supabaseAdmin
    .from('user_accounts')
    .select('id, provider')
    .eq('user_id', userId)
    .eq('provider', 'discord')
    .single()

  // Idempotent: if already unlinked, return success
  if (!discordAccount) {
    logger.info('Discord already unlinked (idempotent)', {
      correlationId,
      userId
    })

    // Fetch current accounts to build identity
    const { data: accounts } = await supabaseAdmin
      .from('user_accounts')
      .select('provider, meta')
      .eq('user_id', userId)

    const identity = await computeIdentityPayload(currentUser, accounts || [])

    const response: UnlinkResponse = {
      ok: true,
      identity: {
        ...identity,
        discord: null
      }
    }

    res.status(200).json(response)
    return
  }

  // Perform unlink in transaction-like sequence
  // 1. Delete Discord account link
  const { error: deleteError } = await supabaseAdmin
    .from('user_accounts')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'discord')

  if (deleteError) {
    logger.error('Failed to delete Discord account link', { correlationId, userId }, deleteError)
    throw httpError.dbError('Failed to unlink Discord account')
  }

  // 2. Restore display_name to ephemeral_display_name
  const ephemeralName = currentUser.ephemeral_display_name || currentUser.display_name
  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({
      display_name: ephemeralName
    })
    .eq('id', userId)

  if (updateError) {
    logger.error('Failed to restore ephemeral display name', { correlationId, userId }, updateError)
    // Non-fatal - continue
  }

  // 3. Update presence display_name for immediate UI update
  await supabaseAdmin
    .from('presence')
    .update({ display_name: ephemeralName })
    .eq('session_id', sessionId)

  // Fetch updated accounts (should only have wallet if any)
  const { data: remainingAccounts } = await supabaseAdmin
    .from('user_accounts')
    .select('provider, meta')
    .eq('user_id', userId)

  const updatedUser = {
    ...currentUser,
    display_name: ephemeralName
  }

  const identity = await computeIdentityPayload(updatedUser, remainingAccounts || [])

  // Structured success log
  logger.info('Discord unlinked successfully', {
    event: 'oauth_unlink_success',
    userId,
    correlationId
  })

  logger.requestComplete('/api/auth/discord/unlink', Date.now() - startTime, {
    correlationId,
    sessionId,
    userId
  })

  const response: UnlinkResponse = {
    ok: true,
    identity: {
      ...identity,
      discord: null
    }
  }

  res.status(200).json(response)
}

export default secureHandler(discordUnlinkHandler, securityConfigs.user)
