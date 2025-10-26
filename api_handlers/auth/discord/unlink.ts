// POST /api/auth/discord/unlink
// Unlinks Discord account from current user
// Idempotent: returns success even if already unlinked
// Recomputes ephemeral flag based on remaining linked accounts

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { ensureSession, setSessionCookie } from '../../_shared/session-helpers.js'
import { httpError } from '../../_shared/errors.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { shortId } from '../../../src/lib/ids.js'

const DEFAULT_SPA_URL = 'http://localhost:5173'

/**
 * Determine if response should be JSON based on Accept header or query param
 */
function wantsJson(req: VercelRequest): boolean {
  // Check query param first (?format=json)
  if (req.query.format === 'json') {
    return true
  }

  // Check Accept header contains application/json
  const acceptHeader = req.headers.accept || ''
  return acceptHeader.includes('application/json')
}

/**
 * Build SPA redirect URL with success query param
 */
function buildSPARedirectUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set('discord_unlinked', '1')
  return url.toString()
}

async function discordUnlinkHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  logger.request('/api/auth/discord/unlink', { correlationId, method: req.method })

  // Detect mode once at top
  const json = wantsJson(req)

  try {
    // 1. Feature flag guard
    if (process.env.ALLOW_DISCORD_UNLINK !== 'true') {
      logger.requestComplete('/api/auth/discord/unlink', Date.now() - startTime, {
        correlationId,
        statusCode: 404,
        reason: 'feature_disabled'
      })
      res.status(404).json({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Discord unlinking is not enabled'
        },
        requestId: correlationId
      })
      return
    }

    // 2. Ensure session exists
    const { sessionId, userId, shouldSetCookie } = await ensureSession(req, res)
    if (shouldSetCookie) {
      setSessionCookie(res, sessionId, req)
    }

    logger.info('Discord unlink request', {
      correlationId,
      sessionId: shortId(sessionId, 8) + '...',
      userId: shortId(userId, 8) + '...'
    })

    // 3. Delete Discord account link (idempotent - returns deleted rows)
    const { data: deleted, error: deleteError } = await supabaseAdmin
      .from('user_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'discord')
      .select('id')

    if (deleteError) {
      logger.error('Failed to delete Discord account', {
        correlationId,
        userId: shortId(userId, 8) + '...',
        errorCode: deleteError.code,
        errorMessage: deleteError.message
      }, deleteError)

      throw httpError.dbError('Failed to unlink Discord account', {
        db: { type: 'QUERY', table: 'user_accounts' }
      })
    }

    const wasLinked = deleted && deleted.length > 0
    const accountId = deleted?.[0]?.id

    if (wasLinked) {
      logger.info('Discord account unlinked', {
        correlationId,
        userId: shortId(userId, 8) + '...',
        accountId: accountId ? shortId(accountId, 8) + '...' : undefined
      })
    } else {
      logger.info('Discord account already unlinked (idempotent)', {
        correlationId,
        userId: shortId(userId, 8) + '...'
      })
    }

    // 4. Count remaining linked accounts for this user
    const { count, error: countError } = await supabaseAdmin
      .from('user_accounts')
      .select('id', { head: true, count: 'exact' })
      .eq('user_id', userId)

    if (countError) {
      logger.error('Failed to count remaining accounts', {
        correlationId,
        userId: shortId(userId, 8) + '...',
        errorCode: countError.code,
        errorMessage: countError.message
      }, countError)

      throw httpError.dbError('Failed to check remaining accounts', {
        db: { type: 'QUERY', table: 'user_accounts' }
      })
    }

    const remainingAccounts = count ?? 0
    const ephemeral = remainingAccounts === 0

    logger.info('Remaining accounts counted', {
      correlationId,
      userId: shortId(userId, 8) + '...',
      remainingAccounts,
      ephemeral
    })

    // 5. Update ephemeral flag based on remaining accounts
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ ephemeral })
      .eq('id', userId)

    if (updateError) {
      logger.error('Failed to update ephemeral flag', {
        correlationId,
        userId: shortId(userId, 8) + '...',
        ephemeral,
        errorCode: updateError.code,
        errorMessage: updateError.message
      }, updateError)

      throw httpError.dbError('Failed to update user status', {
        db: { type: 'QUERY', table: 'users' }
      })
    }

    logger.info('Ephemeral flag updated', {
      correlationId,
      userId: shortId(userId, 8) + '...',
      ephemeral
    })

    // 6. Return success response
    logger.requestComplete('/api/auth/discord/unlink', Date.now() - startTime, {
      correlationId,
      statusCode: json ? 200 : 302,
      responseType: json ? 'json' : 'redirect',
      userId: shortId(userId, 8) + '...',
      wasLinked,
      remainingAccounts,
      ephemeral
    })

    if (json) {
      res.status(200).json({
        unlinked: true,
        alreadyUnlinked: !wasLinked,
        remainingAccounts,
        ephemeral
      })
      return
    } else {
      const spaUrl = process.env.VITE_SITE_URL || DEFAULT_SPA_URL
      const redirectUrl = buildSPARedirectUrl(spaUrl)
      res.status(302).setHeader('Location', redirectUrl).end()
      return
    }

  } catch (error) {
    const durationMs = Date.now() - startTime

    // Extract error info
    let status = 500
    let code = 'INTERNAL'
    let message = 'An unexpected error occurred'

    if (error && typeof error === 'object') {
      if ('httpStatus' in error) status = error.httpStatus as number
      if ('code' in error) code = String(error.code)
      if ('message' in error) message = String(error.message)
    }

    logger.error('Discord unlink error', {
      correlationId,
      errorCode: code,
      statusCode: status,
      durationMs
    }, error as Error)

    // Respond based on mode
    if (json) {
      res.status(status).json({
        error: {
          code,
          message
        },
        requestId: correlationId
      })
      return
    } else {
      // Redirect mode: on error, redirect with error param
      const spaUrl = process.env.VITE_SITE_URL || DEFAULT_SPA_URL
      const url = new URL(spaUrl)
      url.searchParams.set('discord_error', 'UNLINK_FAILED')
      res.status(302).setHeader('Location', url.toString()).end()
      return
    }
  }
}

export default secureHandler(discordUnlinkHandler, securityConfigs.user)
