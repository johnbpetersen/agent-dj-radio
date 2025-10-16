// GET/POST /api/auth/discord/start
// Initiates Discord OAuth flow with 'identify' scope
// GET: Returns 302 redirect to Discord (for browser navigation)
// POST: Returns { redirectUrl } JSON (for fetch API)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { ensureSession, setOAuthStateCookie, debugOAuth } from '../../_shared/session-helpers.js'
import { computeRedirectUri } from '../../_shared/url-helpers.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError } from '../../_shared/errors.js'
import { supabaseAdmin } from '../../_shared/supabase.js'
import * as crypto from 'crypto'

async function discordStartHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Support both GET (browser navigation) and POST (fetch API)
  if (req.method !== 'GET' && req.method !== 'POST') {
    throw httpError.badRequest('Method not allowed', 'Only GET and POST requests are supported')
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  // Environment validation
  const clientId = process.env.DISCORD_CLIENT_ID

  if (!clientId) {
    logger.error('DISCORD_CLIENT_ID not configured', { correlationId })
    throw httpError.internal('Discord authentication not configured')
  }

  // Ensure session exists and get/set cookie
  const host = req.headers.host || 'unknown'
  const { sid, created } = await ensureSession(req, res)

  // Verify session was created/found in database
  const { data: verifySession, error: verifyError } = await supabaseAdmin
    .from('presence')
    .select('session_id, user_id')
    .eq('session_id', sid)
    .single()

  debugOAuth('Discord OAuth start', {
    correlationId,
    host,
    sidSuffix: sid.slice(-6),
    sessionCreated: created,
    sessionVerified: !!verifySession,
    verifyError: verifyError?.code,
    method: req.method,
    supabaseProjectHost: new URL(process.env.SUPABASE_URL || '').hostname
  })

  if (!verifySession) {
    logger.error('Session creation/lookup failed in start handler', {
      correlationId,
      sidSuffix: sid.slice(-6),
      created,
      errorCode: verifyError?.code,
      errorMessage: verifyError?.message
    })
    throw httpError.internal('Failed to create session')
  }

  logger.info('Discord OAuth start', {
    correlationId,
    host,
    sidSuffix: sid.slice(-6),
    sessionCreated: created,
    method: req.method
  })

  // Optional: validate host against allowlist
  const allowedHosts = process.env.ALLOWED_REDIRECT_HOSTS?.split(',').map(h => h.trim())
  if (allowedHosts && allowedHosts.length > 0 && host) {
    const isAllowed = allowedHosts.some(allowed => {
      if (allowed.startsWith('*.')) {
        // Wildcard: *.vercel.app matches preview-xyz.vercel.app
        const domain = allowed.slice(2)
        return host.endsWith(domain)
      }
      return host === allowed
    })

    if (!isAllowed) {
      logger.error('Host not in allowlist', { correlationId, host, allowedHosts })
      throw httpError.badRequest('Invalid request host')
    }
  }

  // Compute redirect_uri using url-helpers (single source of truth)
  const redirectUri = computeRedirectUri(req, '/api/auth/discord/callback')

  debugOAuth('Computed redirect URI', {
    correlationId,
    redirectUri
  })

  logger.info('Discord OAuth computed redirect', {
    correlationId,
    redirectUri
  })

  // Generate CSRF token (state)
  const csrf = crypto.randomUUID()

  // Build state payload with CSRF + session ID
  const statePayload = { csrf, sid }
  const stateJson = JSON.stringify(statePayload)
  const stateBase64 = Buffer.from(stateJson, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  // Set oauth_state cookie for CSRF protection
  setOAuthStateCookie(res, stateBase64, req)

  // Build Discord OAuth URL
  const authUrl = new URL('https://discord.com/api/oauth2/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'identify')
  authUrl.searchParams.set('state', stateBase64)

  const discordAuthUrl = authUrl.toString()

  debugOAuth('Discord OAuth URL generated', {
    correlationId,
    sidSuffix: sid.slice(-6),
    redirectUri,
    stateSuffix: stateBase64.substring(0, 8) + '...'
  })

  logger.info('Discord OAuth URL generated', {
    correlationId,
    sidSuffix: sid.slice(-6),
    redirectUri,
    stateSuffix: stateBase64.substring(0, 8) + '...',
    durationMs: Date.now() - startTime
  })

  // Handle GET vs POST differently
  if (req.method === 'GET') {
    // GET: Return explicit 302 redirect (browser navigation)
    debugOAuth('Returning 302 redirect to Discord', { correlationId })
    res.statusCode = 302
    res.setHeader('Location', discordAuthUrl)
    res.end()
  } else {
    // POST: Return JSON with redirectUrl (fetch API)
    debugOAuth('Returning JSON with redirectUrl', { correlationId })
    res.status(200).json({ redirectUrl: discordAuthUrl })
  }
}

export default secureHandler(discordStartHandler, securityConfigs.public)
