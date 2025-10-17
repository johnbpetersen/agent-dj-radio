// GET/POST /api/session/whoami - Read-only identity endpoint
// Returns current user identity derived from durable session (no writes except presence telemetry)
// Supports both GET and POST for idempotent identity retrieval

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { ensureSession, setSessionCookie } from '../_shared/session-helpers.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { httpError } from '../_shared/errors.js'

interface WhoAmIResponse {
  userId: string
  displayName: string
  ephemeral: boolean
  kind: 'human' | 'agent'
  banned: boolean
  createdAt: string
  sessionId?: string // Only included when DEBUG_AUTH=1
}

async function whoamiHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Accept both GET and POST (idempotent read operation)
  if (req.method !== 'GET' && req.method !== 'POST') {
    throw httpError.badRequest('Method not allowed', 'Only GET and POST requests are supported')
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  try {
    // Use durable session helper - handles all session/user/presence logic
    // This may create a new session if cookie is missing/invalid
    const { userId, sessionId, shouldSetCookie } = await ensureSession(req, res)

    // Set cookie if needed (first visit or came from header)
    if (shouldSetCookie) {
      setSessionCookie(res, sessionId, req)
    }

    // Fetch user data (identity source is sessions → users, NOT presence!)
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, ephemeral, kind, banned, created_at')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      throw httpError.internal('Failed to fetch user', {
        db: {
          type: 'QUERY',
          operation: 'select',
          table: 'users'
        }
      })
    }

    // Build response payload
    const response: WhoAmIResponse = {
      userId: user.id,
      displayName: user.display_name,
      ephemeral: user.ephemeral ?? true, // Default to true for safety
      kind: user.kind || 'human',
      banned: user.banned ?? false,
      createdAt: user.created_at
    }

    // Include sessionId only when DEBUG_AUTH=1 (for debugging)
    if (process.env.DEBUG_AUTH === '1') {
      response.sessionId = sessionId
    }

    logger.requestComplete('/api/session/whoami', Date.now() - startTime, {
      correlationId,
      userId,
      method: req.method,
      newSession: shouldSetCookie
    })

    res.status(200).json(response)

  } catch (error) {
    // All errors will be handled by secureHandler
    throw error
  }
}

export default secureHandler(whoamiHandler, securityConfigs.user)
