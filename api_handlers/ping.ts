// GET /api/ping - Simple health check endpoint
// Returns 200 OK with JSON response { ok: true, timestamp }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { secureHandler, securityConfigs } from './_shared/secure-handler.js'

async function pingHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString()
  })
}

export default secureHandler(pingHandler, securityConfigs.public)
