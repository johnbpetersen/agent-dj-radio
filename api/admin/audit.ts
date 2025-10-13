import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdminAuth } from '../_shared/admin-auth'
import { supabaseAdmin } from '../_shared/supabase.js'
import { getPaymentAuditTrail, getPaymentStatistics } from '../../src/server/x402-audit'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { handleApiError } from '../../src/lib/error-tracking'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Temporarily disabled in dev
  return res.status(501).json({ message: 'admin audit disabled in dev' })

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Admin authentication
  const authError = requireAdminAuth(req)
  if (authError === 'NOT_FOUND') {
    return res.status(404).json({ error: 'Not found' })
  }
  if (authError) {
    logger.requestComplete(req.url || '/api/admin/audit', correlationId, {
      statusCode: 401,
      authError
    })
    return res.status(401).json({ error: authError, correlationId })
  }

  logger.request(req.url || '/api/admin/audit', { correlationId, method: req.method })

  try {
    const { track_id, stats, since } = req.query

    if (track_id) {
      // Get audit trail for specific track
      if (typeof track_id !== 'string') {
        logger.requestComplete(req.url || '/api/admin/audit', correlationId, {
          statusCode: 400,
          error: 'Invalid track_id parameter'
        })
        return res.status(400).json({ error: 'track_id must be a string', correlationId })
      }

      logger.info('Getting payment audit trail for track', {
        correlationId,
        trackId: track_id
      })

      const auditTrail = await getPaymentAuditTrail(supabaseAdmin, track_id)

      logger.requestComplete(req.url || '/api/admin/audit', correlationId, {
        statusCode: 200,
        trackId: track_id,
        eventsCount: auditTrail.length
      })

      return res.status(200).json({
        track_id,
        audit_trail: auditTrail,
        correlationId
      })
    }

    if (stats === 'true') {
      // Get payment statistics
      let startDate: Date | undefined
      if (since && typeof since === 'string') {
        startDate = new Date(since)
        if (isNaN(startDate.getTime())) {
          logger.requestComplete(req.url || '/api/admin/audit', correlationId, {
            statusCode: 400,
            error: 'Invalid since parameter'
          })
          return res.status(400).json({ error: 'Invalid since date format', correlationId })
        }
      }

      logger.info('Getting payment statistics', {
        correlationId,
        since: startDate?.toISOString()
      })

      const statistics = await getPaymentStatistics(supabaseAdmin, startDate)

      if (!statistics) {
        logger.requestComplete(req.url || '/api/admin/audit', correlationId, {
          statusCode: 500,
          error: 'Failed to get payment statistics'
        })
        return res.status(500).json({ error: 'Failed to get payment statistics', correlationId })
      }

      logger.requestComplete(req.url || '/api/admin/audit', correlationId, {
        statusCode: 200,
        successRate: statistics.successRate
      })

      return res.status(200).json({
        statistics,
        period: {
          since: startDate?.toISOString() || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          until: new Date().toISOString()
        },
        correlationId
      })
    }

    // Default: get recent audit events
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50
    if (isNaN(limit) || limit < 1 || limit > 1000) {
      logger.requestComplete(req.url || '/api/admin/audit', correlationId, {
        statusCode: 400,
        error: 'Invalid limit parameter'
      })
      return res.status(400).json({ error: 'limit must be between 1 and 1000', correlationId })
    }

    const { data: recentEvents, error } = await supabaseAdmin
      .from('x402_payment_audit')
      .select(`
        id,
        track_id,
        event_type,
        challenge_nonce,
        transaction_hash,
        error_message,
        correlation_id,
        created_at,
        tracks!inner(prompt, duration_seconds, price_usd)
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(`Failed to get recent audit events: ${error.message}`)
    }

    logger.requestComplete(req.url || '/api/admin/audit', correlationId, {
      statusCode: 200,
      eventsCount: recentEvents?.length || 0,
      limit
    })

    res.status(200).json({
      recent_events: recentEvents || [],
      limit,
      correlationId
    })

  } catch (error) {
    const errorResponse = handleApiError(error, 'admin/audit', { correlationId })

    logger.requestComplete(req.url || '/api/admin/audit', correlationId, {
      statusCode: 500,
      error: error instanceof Error ? error.message : 'Unknown error'
    })

    res.status(500).json(errorResponse)
  }
}