// POST /api/auth/unlink/dev - Unlink dev provider from current session
// Flips users.ephemeral=true if no other accounts remain

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { ensureSession, setSessionCookie } from '../../_shared/session-helpers.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError } from '../../_shared/errors.js'

interface UnlinkDevResponse {
  userId: string
  ephemeral: boolean
  provider: string
}

async function unlinkDevHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
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

    logger.request('/api/auth/unlink/dev', {
      correlationId,
      sessionId,
      userId
    })

    // Delete user_accounts row for dev provider (idempotent)
    const { error: deleteError } = await supabaseAdmin
      .from('user_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'dev')

    if (deleteError) {
      logger.error('Failed to delete user_accounts', {
        correlationId,
        userId
      }, deleteError)

      throw httpError.internal('Failed to unlink provider', {
        db: {
          type: 'QUERY',
          operation: 'delete',
          table: 'user_accounts'
        }
      })
    }

    // Count remaining linked accounts
    const { data: accountsData, error: countError } = await supabaseAdmin
      .from('user_accounts')
      .select('id', { count: 'exact', head: false })
      .eq('user_id', userId)

    if (countError) {
      logger.error('Failed to count remaining accounts', {
        correlationId,
        userId
      }, countError)

      throw httpError.internal('Failed to check remaining accounts', {
        db: {
          type: 'QUERY',
          operation: 'select',
          table: 'user_accounts'
        }
      })
    }

    const remainingAccountsCount = accountsData?.length ?? 0
    const hasRemainingAccounts = remainingAccountsCount > 0

    // Compute ephemeral flag: true if no accounts remain, false if any remain
    const newEphemeralValue = !hasRemainingAccounts

    // Update ephemeral flag
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ ephemeral: newEphemeralValue })
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

    const response: UnlinkDevResponse = {
      userId,
      ephemeral: newEphemeralValue,
      provider: 'dev'
    }

    logger.info('Dev provider unlinked', {
      event: 'dev_unlinked',
      userId,
      provider: 'dev',
      remainingAccountsCount,
      newEphemeralValue,
      correlationId
    })

    logger.requestComplete('/api/auth/unlink/dev', Date.now() - startTime, {
      correlationId,
      sessionId,
      userId
    })

    res.status(200).json(response)

  } catch (error) {
    // All errors will be handled by secureHandler
    throw error
  }
}

export default secureHandler(unlinkDevHandler, securityConfigs.user)
