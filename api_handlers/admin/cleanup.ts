// GET /api/admin/cleanup/oauth-states
// Admin-protected endpoint to delete stale OAuth states
// Requires x-admin-token header matching ADMIN_TOKEN env var

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

async function cleanupHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  logger.request('/api/admin/cleanup/oauth-states', { correlationId, method: req.method })

  // 1. Verify admin token
  const adminToken = process.env.ADMIN_TOKEN
  const providedToken = req.headers['x-admin-token']

  if (!adminToken || adminToken.trim() === '') {
    logger.warn('Admin token not configured', { correlationId })
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Admin authentication not configured'
      },
      requestId: correlationId
    })
    return
  }

  if (!providedToken || providedToken !== adminToken) {
    logger.warn('Invalid admin token provided', {
      correlationId,
      hasToken: !!providedToken
    })

    logger.requestComplete('/api/admin/cleanup/oauth-states', Date.now() - startTime, {
      correlationId,
      statusCode: 401,
      reason: 'invalid_token'
    })

    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid admin token'
      },
      requestId: correlationId
    })
    return
  }

  // 2. Delete stale OAuth states (older than 1 day)
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    logger.info('Cleaning up stale OAuth states', {
      correlationId,
      cutoffTime: oneDayAgo
    })

    const { data, error } = await supabaseAdmin
      .from('oauth_states')
      .delete()
      .lt('created_at', oneDayAgo)
      .select('id')

    if (error) {
      logger.error('Failed to delete stale OAuth states', {
        correlationId,
        errorCode: error.code,
        errorMessage: error.message
      }, error as Error)

      logger.requestComplete('/api/admin/cleanup/oauth-states', Date.now() - startTime, {
        correlationId,
        statusCode: 500,
        reason: 'db_error'
      })

      res.status(500).json({
        error: {
          code: 'DB_ERROR',
          message: 'Failed to delete stale OAuth states'
        },
        requestId: correlationId
      })
      return
    }

    const deletedCount = data?.length || 0

    logger.info('Successfully cleaned up OAuth states', {
      correlationId,
      deletedCount
    })

    logger.requestComplete('/api/admin/cleanup/oauth-states', Date.now() - startTime, {
      correlationId,
      statusCode: 200,
      deletedCount
    })

    res.status(200).json({
      deleted: deletedCount
    })

  } catch (error) {
    logger.error('Unexpected error during cleanup', {
      correlationId
    }, error as Error)

    logger.requestComplete('/api/admin/cleanup/oauth-states', Date.now() - startTime, {
      correlationId,
      statusCode: 500,
      reason: 'unexpected_error'
    })

    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'An unexpected error occurred'
      },
      requestId: correlationId
    })
  }
}

export default secureHandler(cleanupHandler, securityConfigs.admin)
