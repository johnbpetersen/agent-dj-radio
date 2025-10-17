// POST /api/auth/link/dev - Link dev provider to current session
// Flips users.ephemeral=false without creating new user or session

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { ensureSession, setSessionCookie } from '../../_shared/session-helpers.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError, AppError } from '../../_shared/errors.js'

interface LinkDevResponse {
  userId: string
  ephemeral: boolean
  provider: string
}

async function linkDevHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    // Get or create session (durable session flow)
    const { userId, sessionId, shouldSetCookie } = await ensureSession(req, res)

    // Set cookie if needed
    if (shouldSetCookie) {
      setSessionCookie(res, sessionId, req)
    }

    logger.request('/api/auth/link/dev', {
      correlationId,
      sessionId,
      userId
    })

    // Fetch user data for display_name
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, ephemeral, banned')
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

    // Insert user_accounts row with deterministic provider_id
    // Idempotency via insert-with-conflict: no pre-check SELECT
    const providerId = `dev:${userId}`
    const { error: insertError } = await supabaseAdmin
      .from('user_accounts')
      .insert({
        user_id: userId,
        provider: 'dev',
        provider_id: providerId,
        display_name: user.display_name ?? null
      })

    if (insertError) {
      // 23505 = unique constraint violation (already linked)
      // Unique constraints: (user_id, provider) or (provider, provider_id)
      if (insertError.code === '23505' || insertError.message?.includes('duplicate key')) {
        logger.warn('Dev provider already linked (unique constraint)', {
          correlationId,
          userId,
          sessionId,
          dbErrorCode: insertError.code
        })

        res.status(409).json({
          error: {
            code: 'ALREADY_LINKED',
            message: 'Dev provider already linked'
          },
          requestId: correlationId
        })
        return
      }

      // Other insert errors
      logger.error('Failed to insert user_accounts', {
        correlationId,
        userId,
        dbErrorCode: insertError.code,
        dbErrorMessage: insertError.message
      }, insertError)

      // Include DB error code in meta when DEBUG_AUTH=1
      const debugMeta = process.env.DEBUG_AUTH === '1' ? {
        supabase: {
          code: insertError.code,
          message: insertError.message
        }
      } : undefined

      throw httpError.internal('Failed to link provider', {
        db: {
          type: 'QUERY',
          operation: 'insert',
          table: 'user_accounts'
        },
        ...(debugMeta && { context: debugMeta })
      })
    }

    // Flip ephemeral flag to false
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ ephemeral: false })
      .eq('id', userId)

    if (updateError) {
      logger.error('Failed to update ephemeral flag', {
        correlationId,
        userId
      }, updateError)

      throw httpError.internal('Failed to update user', {
        db: {
          type: 'QUERY',
          operation: 'update',
          table: 'users'
        }
      })
    }

    const response: LinkDevResponse = {
      userId,
      ephemeral: false,
      provider: 'dev'
    }

    logger.info('Dev provider linked', {
      event: 'dev_linked',
      userId,
      provider: 'dev',
      providerId,
      correlationId
    })

    logger.requestComplete('/api/auth/link/dev', Date.now() - startTime, {
      correlationId,
      sessionId,
      userId
    })

    res.status(201).json(response)

  } catch (error) {
    // All errors will be handled by secureHandler
    throw error
  }
}

export default secureHandler(linkDevHandler, securityConfigs.user)
