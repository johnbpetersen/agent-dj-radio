// POST /api/auth/discord/start
// Initiates Discord OAuth flow with 'identify' scope
// Redirects user to Discord authorization page

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError } from '../../_shared/errors.js'

async function discordStartHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    throw httpError.badRequest('Method not allowed', 'Only POST requests are supported')
  }

  const correlationId = generateCorrelationId()

  logger.info('Discord OAuth start', { correlationId })

  // Environment validation
  const clientId = process.env.DISCORD_CLIENT_ID
  const redirectUri = process.env.DISCORD_REDIRECT_URI ||
                      `${process.env.VITE_SITE_URL || 'http://localhost:5173'}/api/auth/discord/callback`

  if (!clientId) {
    logger.error('DISCORD_CLIENT_ID not configured', { correlationId })
    throw httpError.internal('Discord authentication not configured')
  }

  // Generate CSRF state token
  const state = crypto.randomUUID()

  // Store state in HTTP-only cookie (10 minute expiry)
  const isProduction = process.env.NODE_ENV === 'production'
  const cookieOptions = [
    `discord_state=${state}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=600', // 10 minutes
    isProduction ? 'Secure' : ''
  ].filter(Boolean).join('; ')

  res.setHeader('Set-Cookie', cookieOptions)

  // Build Discord OAuth URL
  const authUrl = new URL('https://discord.com/api/oauth2/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'identify')
  authUrl.searchParams.set('state', state)

  logger.info('Redirecting to Discord OAuth', {
    correlationId,
    redirectUri,
    state: state.substring(0, 8) + '...'
  })

  // Redirect to Discord
  res.status(302).setHeader('Location', authUrl.toString()).end()
}

export default secureHandler(discordStartHandler, securityConfigs.public)
