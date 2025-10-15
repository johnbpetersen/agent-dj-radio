// POST /api/presence/ping - Keep presence alive
// Updates last_seen_at for presence and user records with throttling

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { requireSessionId } from '../_shared/session.js'
import { checkPresencePingThrottle } from '../../src/server/rate-limit.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

interface PresencePingResponse {
  ok: boolean
  throttled?: boolean
}

async function presencePingHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Check feature flag
  if (process.env.ENABLE_EPHEMERAL_USERS !== 'true') {
    res.status(404).json({ error: 'Feature not available' })
    return
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  try {
    const sessionId = requireSessionId(req)

    logger.request('/api/presence/ping', { correlationId, sessionId })

    // Check throttling - if last ping was < 10s ago, skip DB update
    const throttleResult = checkPresencePingThrottle(sessionId)
    
    if (throttleResult.throttled) {
      logger.debug('Presence ping throttled', { 
        correlationId, 
        sessionId,
        lastPing: throttleResult.resetTime - 10000
      })

      const response: PresencePingResponse = {
        ok: true,
        throttled: true
      }

      res.status(200).json(response)
      return
    }

    // Update presence and user last_seen_at timestamps
    const now = new Date().toISOString()

    // First update presence record
    const { data: presence, error: presenceError } = await supabaseAdmin
      .from('presence')
      .update({ last_seen_at: now })
      .eq('session_id', sessionId)
      .select('user_id')
      .single()

    if (presenceError) {
      logger.warn('Presence update failed', { correlationId, sessionId }, presenceError)
      res.status(404).json({ error: 'Session not found' })
      return
    }

    // Update user record if presence was found
    if (presence?.user_id) {
      const { error: userError } = await supabaseAdmin
        .from('users')
        .update({ last_seen_at: now })
        .eq('id', presence.user_id)

      if (userError) {
        logger.warn('User last_seen_at update failed', { 
          correlationId, 
          sessionId, 
          userId: presence.user_id 
        }, userError)
        // Continue anyway - presence update succeeded
      }
    }

    const response: PresencePingResponse = {
      ok: true,
      throttled: false
    }

    logger.requestComplete('/api/presence/ping', Date.now() - startTime, {
      correlationId,
      sessionId,
      userId: presence?.user_id
    })

    res.status(200).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    logger.error('Presence ping error', { correlationId }, err)

    if (err.message.includes('Missing X-Session-Id') || err.message.includes('Invalid X-Session-Id')) {
      res.status(400).json({ error: err.message, correlationId })
      return
    }

    res.status(500).json({ 
      error: 'Internal server error',
      correlationId
    })
  }
}

export default secureHandler(presencePingHandler, securityConfigs.user)