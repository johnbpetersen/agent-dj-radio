// GET/POST /api/session/hello - Create/retrieve durable session + user identity
// Uses durable sessions table for identity (not presence TTL)
// Supports both GET and POST for idempotent session initialization

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import { ensureSession, setSessionCookie } from '../_shared/session-helpers.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { shortId } from '../../src/lib/ids.js'
import { httpError } from '../_shared/errors.js'
import { computeIdentityPayload, type Identity } from '../_shared/identity.js'

interface SessionHelloResponse {
  user: {
    id: string
    display_name: string
    bio: string | null
    is_agent: boolean
    kind: string
    isWalletLinked: boolean
  }
  identity: Identity
  session_id: string
}

async function sessionHelloHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Accept both GET and POST (idempotent cookie-based session init)
  if (req.method !== 'GET' && req.method !== 'POST') {
    throw httpError.badRequest('Method not allowed', 'Only GET and POST requests are supported')
  }

  // Check feature flag
  if (process.env.ENABLE_EPHEMERAL_USERS !== 'true') {
    throw httpError.notFound('Feature not available', 'Ephemeral users feature is disabled')
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  try {
    // Use durable session helper - handles all session/user/presence logic
    const { userId, sessionId, shouldSetCookie } = await ensureSession(req, res)

    // Set cookie if needed (first visit or came from header)
    if (shouldSetCookie) {
      setSessionCookie(res, sessionId, req)
    }

    // Fetch user data (already exists from ensureSession)
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, bio, is_agent, banned, kind')
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

    // Check if user is banned
    if (user.banned) {
      throw httpError.forbidden('Account banned', 'This account has been banned')
    }

    // Check for linked accounts (wallet)
    const { data: userAccounts } = await supabaseAdmin
      .from('user_accounts')
      .select('provider, meta')
      .eq('user_id', userId)

    const isWalletLinked = userAccounts?.some(acc => acc.provider === 'wallet') ?? false

    // Compute identity payload
    const identity = await computeIdentityPayload(user, userAccounts || [])

    const response: SessionHelloResponse = {
      user: {
        ...sanitizeForClient(user, []),
        isWalletLinked
      },
      identity,
      session_id: sessionId
    }

    logger.requestComplete('/api/session/hello', Date.now() - startTime, {
      correlationId,
      userId,
      sessionId: shortId(sessionId, -6),
      action: shouldSetCookie ? 'new_session' : 'existing_session',
      isWalletLinked
    })

    res.status(200).json(response)

  } catch (error) {
    // All errors will be handled by secureHandler
    throw error
  }
}

export default secureHandler(sessionHelloHandler, securityConfigs.user)
