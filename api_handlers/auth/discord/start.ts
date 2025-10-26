// GET /api/auth/discord/start
// Initiates Discord OAuth flow with PKCE
// Generates state + code_verifier, stores them, returns authorize URL

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { ensureSession, setSessionCookie } from '../../_shared/session-helpers.js'
import { httpError } from '../../_shared/errors.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { shortId } from '../../../src/lib/ids.js'
import {
  generateState,
  generateCodeVerifier,
  computeCodeChallenge,
  buildDiscordAuthorizeUrl
} from '../../_shared/discord-pkce.js'

const MAX_COLLISION_RETRIES = 3

async function discordStartHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  logger.request('/api/auth/discord/start', { correlationId, method: req.method })

  // 1. Feature flag guard
  if (process.env.ENABLE_DISCORD_LINKING !== 'true') {
    logger.requestComplete('/api/auth/discord/start', Date.now() - startTime, {
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

  // 2. Validate required environment variables
  const clientId = process.env.DISCORD_CLIENT_ID
  const redirectUri = process.env.DISCORD_REDIRECT_URI
  const apiBase = process.env.DISCORD_API_BASE || 'https://discord.com/api'

  if (!clientId || clientId.trim() === '') {
    logger.requestComplete('/api/auth/discord/start', Date.now() - startTime, {
      correlationId,
      statusCode: 400,
      reason: 'missing_client_id'
    })
    res.status(400).json({
      error: {
        code: 'MISSING_CONFIG',
        message: 'Discord OAuth is not properly configured',
        detail: 'DISCORD_CLIENT_ID is required'
      },
      requestId: correlationId
    })
    return
  }

  if (!redirectUri || redirectUri.trim() === '') {
    logger.requestComplete('/api/auth/discord/start', Date.now() - startTime, {
      correlationId,
      statusCode: 400,
      reason: 'missing_redirect_uri'
    })
    res.status(400).json({
      error: {
        code: 'MISSING_CONFIG',
        message: 'Discord OAuth is not properly configured',
        detail: 'DISCORD_REDIRECT_URI is required'
      },
      requestId: correlationId
    })
    return
  }

  // 3. Ensure session exists
  const { sessionId, shouldSetCookie } = await ensureSession(req, res)
  if (shouldSetCookie) {
    setSessionCookie(res, sessionId, req)
  }

  logger.info('Discord OAuth start for session', {
    correlationId,
    sessionId: shortId(sessionId, 8) + '...',
    hasClientId: !!clientId,
    hasRedirectUri: !!redirectUri
  })

  // 4. Generate PKCE parameters with collision retry
  let state: string
  let codeVerifier: string
  let codeChallenge: string
  let insertSuccess = false
  let attempts = 0

  while (!insertSuccess && attempts < MAX_COLLISION_RETRIES) {
    attempts++

    // Generate fresh parameters
    state = generateState()
    codeVerifier = generateCodeVerifier()
    codeChallenge = computeCodeChallenge(codeVerifier)

    logger.info('Generated PKCE parameters', {
      correlationId,
      attempt: attempts,
      stateLength: state.length,
      verifierLength: codeVerifier.length,
      challengeLength: codeChallenge.length
    })

    // 5. Store state in database
    try {
      const { error: insertError } = await supabaseAdmin
        .from('oauth_states')
        .insert({
          session_id: sessionId,
          provider: 'discord',
          state,
          code_verifier: codeVerifier,
          created_at: new Date().toISOString()
        })

      if (insertError) {
        // Check for unique constraint violation (state collision)
        if (insertError.code === '23505') {
          logger.warn('OAuth state collision, retrying', {
            correlationId,
            attempt: attempts,
            maxRetries: MAX_COLLISION_RETRIES,
            errorCode: insertError.code
          })
          continue // Retry with new state
        }

        // Other database error
        logger.error('Failed to store OAuth state', {
          correlationId,
          sessionId: shortId(sessionId, 8) + '...',
          errorCode: insertError.code,
          errorMessage: insertError.message
        }, insertError)

        throw httpError.dbError('Failed to initialize OAuth flow', {
          db: { type: 'QUERY', operation: 'insert', table: 'oauth_states' },
          context: {
            route: '/api/auth/discord/start',
            method: 'GET',
            targetUrl: 'supabase://oauth_states'
          }
        })
      }

      insertSuccess = true
      logger.info('OAuth state stored successfully', {
        correlationId,
        sessionId: shortId(sessionId, 8) + '...',
        attempt: attempts
      })

    } catch (error) {
      // Re-throw AppError as-is (secureHandler will format it)
      if (error && typeof error === 'object' && 'httpStatus' in error) {
        throw error
      }

      // Unexpected error
      logger.error('Unexpected error storing OAuth state', {
        correlationId,
        sessionId: shortId(sessionId, 8) + '...'
      }, error as Error)

      res.status(500).json({
        error: {
          code: 'INTERNAL',
          message: 'An unexpected error occurred'
        },
        requestId: correlationId
      })
      return
    }
  }

  // Check if we exhausted retries
  if (!insertSuccess) {
    logger.error('Failed to store OAuth state after max retries', {
      correlationId,
      attempts,
      maxRetries: MAX_COLLISION_RETRIES
    })

    res.status(500).json({
      error: {
        code: 'DB_ERROR',
        message: 'Failed to initialize OAuth flow after multiple attempts',
        detail: 'State collision retry limit exceeded'
      },
      requestId: correlationId
    })
    return
  }

  // 6. Build Discord authorize URL
  const authorizeUrl = buildDiscordAuthorizeUrl({
    apiBase,
    clientId,
    redirectUri,
    state: state!,
    codeChallenge: codeChallenge!,
    scope: 'identify'
  })

  logger.info('Discord authorize URL built', {
    correlationId,
    urlLength: authorizeUrl.length,
    hasState: authorizeUrl.includes('state='),
    hasChallenge: authorizeUrl.includes('code_challenge=')
  })

  // 7. Respond based on Accept header
  const acceptHeader = req.headers.accept || ''
  const wantsJson = acceptHeader.includes('application/json')

  if (wantsJson) {
    // JSON response
    logger.requestComplete('/api/auth/discord/start', Date.now() - startTime, {
      correlationId,
      statusCode: 200,
      responseType: 'json',
      sessionId: shortId(sessionId, 8) + '...'
    })

    res.status(200).json({ authorizeUrl })
  } else {
    // HTML redirect
    logger.requestComplete('/api/auth/discord/start', Date.now() - startTime, {
      correlationId,
      statusCode: 302,
      responseType: 'redirect',
      sessionId: shortId(sessionId, 8) + '...'
    })

    res.status(302).setHeader('Location', authorizeUrl).end()
  }
}

export default secureHandler(discordStartHandler, securityConfigs.user)
