// POST /api/auth/link/dev - Link dev provider to current session
// Flips users.ephemeral=false without creating new user or session

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { ensureSession, setSessionCookie } from '../../_shared/session-helpers.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError } from '../../_shared/errors.js'

interface LinkDevResponse {
  userId: string
  ephemeral: boolean
  provider: string
}

function hasSidCookie(req: VercelRequest): boolean {
  const raw = (req.headers?.cookie ?? '') as string
  return /(^|;\s*)sid=/.test(raw)
}

async function linkDevHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Feature flag (keep consistent with your project)
  if (process.env.ENABLE_EPHEMERAL_USERS !== 'true') {
    res.status(404).json({ error: 'Feature not available' })
    return
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  // Durable session
  const { userId, sessionId, shouldSetCookie } = await ensureSession(req, res)
  // Be sticky: set cookie if request lacked one
  if (shouldSetCookie || !hasSidCookie(req)) {
    setSessionCookie(res, sessionId, req)
  }

  logger.request('/api/auth/link/dev', { correlationId, sessionId, userId })

  // Minimal user state
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, ephemeral, banned')
    .eq('id', userId)
    .single()

  if (userError || !user) {
    throw httpError.internal('Failed to fetch user', {
      db: { type: 'QUERY', operation: 'select', table: 'users' }
    })
  }

  // Insert-with-conflict (race-safe, idempotent)
  const providerId = `dev:${userId}`
  const { error: insertError } = await supabaseAdmin
    .from('user_accounts')
    .insert({
      user_id: userId,
      provider: 'dev',               // allowed by updated CHECK constraint
      provider_user_id: providerId,  // correct column per your schema
      // meta omitted (defaults to '{}'::jsonb)
    })

  if (insertError) {
    // Unique violation → already linked
    if (insertError.code === '23505' || insertError.message?.includes('duplicate key')) {
      logger.warn('Dev provider already linked (unique constraint)', {
        correlationId,
        userId,
        sessionId,
        dbErrorCode: insertError.code
      })

      res.status(409).json({
        error: { code: 'ALREADY_LINKED', message: 'Dev provider already linked' },
        requestId: correlationId
      })
      return
    }

    logger.error('Failed to insert user_accounts', {
      correlationId,
      userId,
      dbErrorCode: insertError.code,
      dbErrorMessage: insertError.message
    }, insertError)

    throw httpError.internal('Failed to link provider', {
      db: { type: 'QUERY', operation: 'insert', table: 'user_accounts' }
    })
  }

  // Flip ephemeral -> false (linked)
  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ ephemeral: false })
    .eq('id', userId)

  if (updateError) {
    logger.error('Failed to update ephemeral flag', { correlationId, userId }, updateError)
    throw httpError.internal('Failed to update user', {
      db: { type: 'QUERY', operation: 'update', table: 'users' }
    })
  }

  const response: LinkDevResponse = { userId, ephemeral: false, provider: 'dev' }

  logger.info('Dev provider linked', {
    event: 'dev_linked',
    userId,
    provider: 'dev',
    providerUserId: providerId,
    correlationId
  })

  logger.requestComplete('/api/auth/link/dev', Date.now() - startTime, {
    correlationId,
    sessionId,
    userId
  })

  res.status(201).json(response)
}

export default secureHandler(linkDevHandler, securityConfigs.user)