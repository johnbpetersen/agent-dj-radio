// GET/POST /api/auth/discord/start
// Initiates Discord OAuth flow with 'identify' scope
// GET: Returns 302 redirect to Discord (for browser navigation)
// POST: Returns { redirectUrl } JSON (for fetch API)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { ensureSession, setOAuthStateCookie, isHttps } from '../../_shared/session-helpers.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError } from '../../_shared/errors.js'
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
  const { sid } = await ensureSession(req, res)

  logger.info('Discord OAuth start', {
    correlationId,
    sidSuffix: sid.slice(-6),
    method: req.method
  })

  // Compute redirect_uri from request host
  const host = req.headers.host
  if (!host) {
    logger.error('Missing Host header', { correlationId })
    throw httpError.badRequest('Invalid request: missing host header')
  }

  // Optional: validate host against allowlist
  const allowedHosts = process.env.ALLOWED_REDIRECT_HOSTS?.split(',').map(h => h.trim())
  if (allowedHosts && allowedHosts.length > 0) {
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

  // Determine protocol dynamically
  const proto = isHttps(req) ? 'https' : 'http'
  const redirectUri = `${proto}://${host}/api/auth/discord/callback`

  logger.info('Discord OAuth computed redirect', {
    correlationId,
    host,
    redirectUri,
    proto
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
    res.statusCode = 302
    res.setHeader('Location', discordAuthUrl)
    res.end()
  } else {
    // POST: Return JSON with redirectUrl (fetch API)
    res.status(200).json({ redirectUrl: discordAuthUrl })
  }
}

export default secureHandler(discordStartHandler, securityConfigs.public)
