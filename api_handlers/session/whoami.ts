// GET /api/session/whoami - Read-only identity endpoint
// Returns current user identity derived from durable session (no writes)
// GET-only (idempotent)

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
  capabilities: {
    canChat: boolean
  }
  sessionId?: string // Only included when DEBUG_AUTH=1
}

/** Unconditional canChat rule: only non-ephemeral & not banned can chat */
function computeCanChat(user: { banned: boolean; ephemeral: boolean }): boolean {
  return !user.banned && !user.ephemeral
}

function hasSidCookie(req: VercelRequest): boolean {
  const raw = (req.headers?.cookie ?? '') as string
  return /(^|;\s*)sid=/.test(raw)
}

async function whoamiHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    // Keep current project behavior (Bad Request on non-GET)
    throw httpError.badRequest('Method not allowed', 'Only GET requests are supported')
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  // Durable session (may create a new session if cookie missing/invalid)
  const { userId, sessionId, shouldSetCookie } = await ensureSession(req, res)

  // Be sticky: if request came in without a sid cookie, set it now.
  if (shouldSetCookie || !hasSidCookie(req)) {
    setSessionCookie(res, sessionId, req)
  }

  // Identity is sessions → users only (never presence)
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, display_name, ephemeral, kind, banned, created_at')
    .eq('id', userId)
    .single()

  if (userError || !user) {
    throw httpError.internal('Failed to fetch user', {
      db: { type: 'QUERY', operation: 'select', table: 'users' }
    })
  }

  const response: WhoAmIResponse = {
    userId: user.id,
    displayName: user.display_name,
    ephemeral: user.ephemeral ?? true,
    kind: (user.kind as 'human' | 'agent') || 'human',
    banned: user.banned ?? false,
    createdAt: user.created_at,
    capabilities: {
      canChat: computeCanChat({
        banned: user.banned ?? false,
        ephemeral: user.ephemeral ?? true
      })
    }
  }

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
}

export default secureHandler(whoamiHandler, securityConfigs.user)