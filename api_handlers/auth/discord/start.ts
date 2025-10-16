// GET /api/auth/discord/start
// Initiates Discord OAuth flow with 'identify' scope
// Redirects user to Discord authorization page

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError } from '../../_shared/errors.js'
import crypto from 'crypto'

async function discordStartHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    throw httpError.badRequest('Method not allowed', 'Only GET requests are supported')
  }

  const correlationId = generateCorrelationId()

  logger.info('Discord OAuth start', { correlationId })

  // Environment validation
  const clientId = process.env.DISCORD_CLIENT_ID

  if (!clientId) {
    logger.error('DISCORD_CLIENT_ID not configured', { correlationId })
    throw httpError.internal('Discord authentication not configured')
  }

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

  // Determine protocol
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https')
  const redirectUri = `${proto}://${host}/api/auth/discord/callback`

  // Extract session ID from header
  const sid = req.headers['x-session-id']?.toString() ?? ''

  // Validate UUID v4 format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!sid || !uuidRegex.test(sid)) {
    logger.error('Invalid or missing X-Session-Id header', { correlationId })
    throw httpError.badRequest('Invalid session ID')
  }

  console.log('[discord/start] sid from header?', !!sid, 'setting cookie & state payload')

  // Generate CSRF token
  const csrf = crypto.randomUUID()

  // Build state payload with CSRF + session ID (belt-and-suspenders)
  const statePayload = { csrf, sid }
  const stateJson = JSON.stringify(statePayload)
  const stateBase64 = Buffer.from(stateJson, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  // Store both cookies (CSRF state + session ID) - 10 minute expiry
  const isProduction = process.env.NODE_ENV === 'production'

  const stateCookie = [
    `discord_state=${stateBase64}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=600', // 10 minutes
    isProduction ? 'Secure' : ''
  ].filter(Boolean).join('; ')

  const sessionCookie = [
    `x_session_id=${encodeURIComponent(sid)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=604800', // 7 days
    isProduction ? 'Secure' : ''
  ].filter(Boolean).join('; ')

  res.setHeader('Set-Cookie', [stateCookie, sessionCookie])

  // Build Discord OAuth URL
  const authUrl = new URL('https://discord.com/api/oauth2/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'identify')
  authUrl.searchParams.set('state', stateBase64)

  logger.info('Returning Discord OAuth URL', {
    correlationId,
    redirectUri,
    state: stateBase64.substring(0, 8) + '...'
  })

  // Return JSON with redirectUrl (client will navigate)
  // Use the standard response pattern from session/hello and station/state
  console.log('[discord/start] returning JSON redirectUrl')
  res.status(200).json({ redirectUrl: authUrl.toString() })
}

export default secureHandler(discordStartHandler, securityConfigs.public)
