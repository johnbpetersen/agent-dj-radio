// POST /api/auth/discord/unlink - Disconnect Discord and revert to ephemeral identity
// Cookie-based session auth (no presence dependency for authorization)
// Returns 401 if unauthorized, 200 on success (idempotent)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { requireSession } from '../_shared/session.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { httpError } from '../_shared/errors.js'

interface UnlinkResponse {
  ok: boolean
}

async function discordUnlinkHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    throw httpError.badRequest('Method not allowed', 'Only POST requests are supported')
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  // Get session using cookie-based auth (throws 401 if missing/invalid)
  const session = await requireSession(req)
  const { userId, sessionId } = session

  logger.request('/api/auth/discord/unlink', { correlationId, userId, sessionId })

  // Fetch current user record
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, display_name, ephemeral_display_name, discord_user_id, discord_username')
    .eq('id', userId)
    .single()

  if (userError || !user) {
    // User record not found - session references deleted user
    logger.warn('Unlink attempted for non-existent user', { correlationId, userId })
    throw httpError.unauthorized('Session expired', 'Please refresh the page and try again')
  }

  logger.debug('Discord unlink request', {
    correlationId,
    userId,
    displayName: user.display_name,
    isDiscordLinked: !!user.discord_user_id
  })

  // Idempotent: if already unlinked, return success immediately
  if (!user.discord_user_id) {
    logger.info('Discord already unlinked (idempotent)', { correlationId, userId })
    res.status(200).json({ ok: true } satisfies UnlinkResponse)
    return
  }

  // Perform unlink in atomic transaction
  // 1. Update users table: clear Discord fields, restore ephemeral name
  const ephemeralName = user.ephemeral_display_name || user.display_name
  const { error: updateUserError } = await supabaseAdmin
    .from('users')
    .update({
      display_name: ephemeralName,
      discord_user_id: null,
      discord_username: null,
      discord_avatar_hash: null,
      discord_discriminator: null
    })
    .eq('id', userId)
    .not('discord_user_id', 'is', null) // Prevent race: only update if still linked

  if (updateUserError) {
    logger.error('Failed to update user record during unlink', { correlationId, userId }, updateUserError)
    throw httpError.dbError('Failed to unlink Discord account')
  }

  // 2. Update presence table: sync display_name for immediate UI reflection
  await supabaseAdmin
    .from('presence')
    .update({ display_name: ephemeralName })
    .eq('session_id', sessionId)

  // Structured success log
  logger.info('Discord unlinked successfully', {
    event: 'oauth_unlink_success',
    userId,
    correlationId,
    restoredName: ephemeralName
  })

  logger.requestComplete('/api/auth/discord/unlink', Date.now() - startTime, {
    correlationId,
    userId,
    sessionId
  })

  res.status(200).json({ ok: true } satisfies UnlinkResponse)
}

export default secureHandler(discordUnlinkHandler, securityConfigs.user)
