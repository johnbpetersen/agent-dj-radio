// Tombstone handler for /api/auth/discord/start
// Returns 410 Gone and clears oauth_state cookie
// TODO: Remove this file in next release after cookie cleanup propagates

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'

async function discordStartTombstone(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Clear oauth_state cookie (cleanup for users who initiated OAuth before removal)
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'http'
  const isHttps = proto === 'https' || process.env.NODE_ENV === 'production'
  const secure = isHttps ? 'Secure; ' : ''

  res.setHeader(
    'Set-Cookie',
    `oauth_state=; HttpOnly; SameSite=Lax; ${secure}Path=/; Max-Age=0`
  )

  res.status(410).json({
    error: {
      code: 'GONE',
      message: 'Discord OAuth was removed from this application'
    }
  })
}

export default secureHandler(discordStartTombstone, securityConfigs.public)
