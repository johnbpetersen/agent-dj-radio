// GET /api/auth/discord/callback
// Completes Discord OAuth flow: exchange code, fetch user, link account
// Implements PKCE verification and account linking with idempotency

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { ensureSession, setSessionCookie } from '../../_shared/session-helpers.js'
import { httpError } from '../../_shared/errors.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { shortId } from '../../../src/lib/ids.js'
import { exchangeCodeForToken, fetchDiscordUser } from '../../_shared/discord-api.js'

const DEFAULT_STATE_TTL_SEC = 600 // 10 minutes
const DEFAULT_SPA_URL = 'http://localhost:5173'

interface OAuthStateRow {
  id: string
  session_id: string
  code_verifier: string
  created_at: string
}

/**
 * Check if OAuth state has expired based on TTL
 */
function isStateExpired(createdAt: string, ttlSec: number): boolean {
  const createdTime = new Date(createdAt).getTime()
  const now = Date.now()
  const ageSeconds = (now - createdTime) / 1000
  return ageSeconds > ttlSec
}

/**
 * Build SPA redirect URL with success or error query param
 */
function buildSPARedirectUrl(baseUrl: string, success: boolean, errorCode?: string): string {
  const url = new URL(baseUrl)

  if (success) {
    url.searchParams.set('discord_linked', '1')
  } else if (errorCode) {
    url.searchParams.set('discord_error', errorCode)
  }

  return url.toString()
}

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
 * Map error codes to user-facing redirect error codes
 */
function mapErrorToRedirectCode(errorCode: string): string {
  switch (errorCode) {
    case 'INVALID_STATE':
    case 'EXPIRED_STATE':
    case 'WRONG_SESSION':
      return 'INVALID_STATE'

    case 'UPSTREAM_4XX':
      return 'OAUTH_FAILED'

    case 'UPSTREAM_5XX':
    case 'NETWORK_ERROR':
      return 'OAUTH_UNAVAILABLE'

    case 'ACCOUNT_IN_USE':
      return 'ACCOUNT_IN_USE'

    default:
      return 'OAUTH_FAILED'
  }
}

/**
 * Extract HTTP error info from thrown error
 */
function toHttpError(error: unknown): { status: number; code: string; message: string } {
  if (error && typeof error === 'object') {
    const httpStatus = 'httpStatus' in error ? (error.httpStatus as number) : 500
    const code = 'code' in error ? String(error.code) : 'INTERNAL'
    const message = 'message' in error ? String(error.message) : 'An unexpected error occurred'
    return { status: httpStatus, code, message }
  }
  return { status: 500, code: 'INTERNAL', message: 'An unexpected error occurred' }
}

async function discordCallbackHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  logger.request('/api/auth/discord/callback', { correlationId, method: req.method })

  // 1. Detect mode once at top
  const json = wantsJson(req)

  // Track state validation for cleanup
  let stateValidated = false
  let oauthState: OAuthStateRow | null = null

  try {
    // 2. Feature flag guard
    if (process.env.ENABLE_DISCORD_LINKING !== 'true') {
      logger.requestComplete('/api/auth/discord/callback', Date.now() - startTime, {
        correlationId,
        statusCode: 404,
        reason: 'feature_disabled'
      })
      res.status(404).json({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Discord linking is not enabled'
        },
        requestId: correlationId
      })
      return
    }

    // 3. Validate required environment variables
    const clientId = process.env.DISCORD_CLIENT_ID
    const clientSecret = process.env.DISCORD_CLIENT_SECRET // Optional
    const redirectUri = process.env.DISCORD_REDIRECT_URI
    const apiBase = process.env.DISCORD_API_BASE || 'https://discord.com/api'
    const spaUrl = process.env.VITE_SITE_URL || DEFAULT_SPA_URL
    const stateTtl = parseInt(process.env.OAUTH_STATE_TTL_SEC || String(DEFAULT_STATE_TTL_SEC), 10)

    if (!clientId || clientId.trim() === '') {
      throw httpError.badRequest('Discord OAuth is not properly configured')
    }

    if (!redirectUri || redirectUri.trim() === '') {
      throw httpError.badRequest('Discord OAuth is not properly configured')
    }

    // 4. Parse query parameters
    const code = req.query.code as string | undefined
    const state = req.query.state as string | undefined
    const error = req.query.error as string | undefined
    const errorDescription = req.query.error_description as string | undefined

    // Handle Discord OAuth errors (user cancelled, etc.)
    if (error) {
      logger.warn('Discord OAuth error received', {
        correlationId,
        error,
        errorDescription
      })

      throw httpError.badRequest(`Discord authorization failed: ${errorDescription || error}`)
    }

    // Validate required params
    if (!code || code.trim() === '') {
      throw httpError.badRequest('Missing authorization code')
    }

    if (!state || state.trim() === '') {
      throw httpError.badRequest('Missing state parameter')
    }

    // 5. Ensure session exists
    const { sessionId, userId, shouldSetCookie } = await ensureSession(req, res)
    if (shouldSetCookie) {
      setSessionCookie(res, sessionId, req)
    }

    logger.info('Discord callback for session', {
      correlationId,
      sessionId: shortId(sessionId, 8) + '...',
      codeLength: code.length,
      stateLength: state.length
    })

    // 6. Fetch OAuth state from database
    const { data: fetchedState, error: fetchError } = await supabaseAdmin
      .from('oauth_states')
      .select('id, session_id, code_verifier, created_at')
      .eq('provider', 'discord')
      .eq('state', state)
      .single()

    if (fetchError || !fetchedState) {
      logger.warn('OAuth state not found', {
        correlationId,
        state: state.slice(0, 16) + '...',
        dbError: fetchError?.message
      })
      const err = httpError.badRequest('Invalid or expired state')
      ;(err as any).customCode = 'INVALID_STATE'
      throw err
    }

    oauthState = fetchedState

    // 7. Validate state: not expired
    if (isStateExpired(oauthState.created_at, stateTtl)) {
      logger.warn('OAuth state expired', {
        correlationId,
        stateId: oauthState.id.slice(0, 8) + '...',
        createdAt: oauthState.created_at,
        ttlSec: stateTtl
      })
      const err = httpError.badRequest('OAuth state expired')
      ;(err as any).customCode = 'EXPIRED_STATE'
      throw err
    }

    // 8. Validate state: session match
    if (oauthState.session_id !== sessionId) {
      logger.warn('OAuth state session mismatch', {
        correlationId,
        stateSessionId: shortId(oauthState.session_id, 8) + '...',
        currentSessionId: shortId(sessionId, 8) + '...'
      })
      const err = httpError.badRequest('State belongs to different session')
      ;(err as any).customCode = 'WRONG_SESSION'
      throw err
    }

    // State is validated - mark for cleanup
    stateValidated = true

    // 9. Exchange code for token (PKCE)
    const tokenResponse = await exchangeCodeForToken({
      code,
      codeVerifier: oauthState.code_verifier,
      clientId,
      clientSecret,
      redirectUri,
      apiBase,
      correlationId
    })

    // 10. Fetch Discord user info
    const discordUser = await fetchDiscordUser({
      accessToken: tokenResponse.access_token,
      apiBase,
      correlationId
    })

    logger.info('Discord user fetched', {
      correlationId,
      discordId: discordUser.id.slice(0, 8) + '...',
      username: discordUser.username,
      globalName: discordUser.global_name
    })

    // 11. Link account (insert-first pattern for idempotency)
    const now = new Date().toISOString()
    const accountMeta = {
      id: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      global_name: discordUser.global_name,
      avatar: discordUser.avatar,
      linked_at: now
    }

    // Try to insert account link (userId from ensureSession)
    const { error: insertError } = await supabaseAdmin
      .from('user_accounts')
      .insert({
        user_id: userId,
        provider: 'discord',
        provider_user_id: discordUser.id,
        meta: accountMeta
      })

    if (insertError) {
      // Handle unique constraint violation (23505)
      if (insertError.code === '23505') {
        logger.info('Discord account already linked, checking ownership', {
          correlationId,
          discordId: discordUser.id.slice(0, 8) + '...',
          currentUserId: userId.slice(0, 8) + '...'
        })

        // Check if same user (idempotent) or different user (conflict)
        const { data: existing } = await supabaseAdmin
          .from('user_accounts')
          .select('user_id')
          .eq('provider', 'discord')
          .eq('provider_user_id', discordUser.id)
          .single()

        if (existing && existing.user_id === userId) {
          // Idempotent success - already linked to this user
          logger.info('Idempotent relink: account already linked to this user', {
            correlationId,
            userId: userId.slice(0, 8) + '...',
            discordId: discordUser.id.slice(0, 8) + '...'
          })
          // Continue to success path (don't throw)
        } else {
          // Conflict - linked to different user
          logger.warn('Discord account already linked to different user', {
            correlationId,
            discordId: discordUser.id.slice(0, 8) + '...',
            currentUserId: userId.slice(0, 8) + '...',
            existingUserId: existing?.user_id.slice(0, 8) + '...'
          })

          const err = httpError.conflict('This Discord account is already linked to another user')
          ;(err as any).customCode = 'ACCOUNT_IN_USE'
          throw err
        }
      } else {
        // Other DB error
        logger.error('Failed to insert user account', {
          correlationId,
          userId: userId.slice(0, 8) + '...',
          errorCode: insertError.code,
          errorMessage: insertError.message
        }, insertError)

        throw httpError.dbError('Failed to link Discord account', {
          db: { type: 'QUERY', table: 'user_accounts' }
        })
      }
    } else {
      // New link created
      logger.info('Discord account linked successfully', {
        correlationId,
        userId: userId.slice(0, 8) + '...',
        discordId: discordUser.id.slice(0, 8) + '...'
      })
    }

    // 12. Update ephemeral flag (idempotent with WHERE clause)
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ ephemeral: false })
      .eq('id', userId)
      .eq('ephemeral', true) // Only update if currently ephemeral

    if (updateError) {
      logger.error('Failed to update ephemeral flag', {
        correlationId,
        userId: userId.slice(0, 8) + '...',
        errorCode: updateError.code,
        errorMessage: updateError.message
      }, updateError)
      // Don't throw - link succeeded, this is non-critical
    }

    // 13. Return success response
    logger.requestComplete('/api/auth/discord/callback', Date.now() - startTime, {
      correlationId,
      statusCode: json ? 200 : 302,
      responseType: json ? 'json' : 'redirect',
      userId: userId.slice(0, 8) + '...',
      discordId: discordUser.id.slice(0, 8) + '...'
    })

    if (json) {
      res.status(200).json({
        success: true,
        userId,
        provider: 'discord',
        discordUser: {
          id: discordUser.id,
          username: discordUser.username,
          global_name: discordUser.global_name
        }
      })
      return
    } else {
      const redirectUrl = buildSPARedirectUrl(spaUrl, true)
      res.status(302).setHeader('Location', redirectUrl).end()
      return
    }

  } catch (error) {
    const durationMs = Date.now() - startTime
    console.log('[DEBUG] Caught error:', { error, name: error instanceof Error ? error.name : typeof error })

    // Extract error info
    const { status, code, message } = toHttpError(error)
    console.log('[DEBUG] Extracted:', { status, code, message })

    // Determine custom code based on error properties
    let customCode = code
    if (error && typeof error === 'object') {
      // Check for customCode property first
      if ('customCode' in error && typeof (error as any).customCode === 'string') {
        customCode = (error as any).customCode
      }
      // Fallback: infer from error message for specific cases
      else if (code === 'BAD_REQUEST') {
        if (message.includes('Invalid or expired state')) {
          customCode = 'INVALID_STATE'
        } else if (message.includes('OAuth state expired')) {
          customCode = 'EXPIRED_STATE'
        } else if (message.includes('different session')) {
          customCode = 'WRONG_SESSION'
        }
      } else if (code === 'CONFLICT') {
        // All conflict errors in this handler are ACCOUNT_IN_USE
        customCode = 'ACCOUNT_IN_USE'
      }
    }

    logger.error('Discord callback error', {
      correlationId,
      errorCode: code,
      customCode,
      statusCode: status,
      durationMs
    }, error as Error)

    // Respond based on mode (NO RETHROW)
    if (json) {
      // JSON mode: return proper status code
      res.status(status).json({
        error: {
          code: customCode,
          message
        },
        requestId: correlationId
      })
      return
    } else {
      // Redirect mode: map error → query code, always 302
      const redirectCode = mapErrorToRedirectCode(customCode)
      const spaUrl = process.env.VITE_SITE_URL || DEFAULT_SPA_URL
      const redirectUrl = buildSPARedirectUrl(spaUrl, false, redirectCode)
      res.status(302).setHeader('Location', redirectUrl).end()
      return
    }

  } finally {
    // 14. One-time use: if state was validated, delete it regardless of success/failure
    if (stateValidated && oauthState) {
      try {
        await supabaseAdmin
          .from('oauth_states')
          .delete()
          .eq('id', oauthState.id)

        logger.info('OAuth state consumed', {
          correlationId,
          stateId: oauthState.id.slice(0, 8) + '...'
        })
      } catch (deleteError) {
        logger.error('Failed to delete OAuth state', {
          correlationId,
          stateId: oauthState.id.slice(0, 8) + '...'
        }, deleteError as Error)
        // Don't throw - state will eventually expire
      }
    }
  }
}

export default secureHandler(discordCallbackHandler, securityConfigs.user)
