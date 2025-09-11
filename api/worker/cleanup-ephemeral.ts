// POST /api/worker/cleanup-ephemeral - Background cleanup job
// Cleans up expired presence records and ephemeral users

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

interface CleanupEphemeralResponse {
  ok: boolean
  presence_deleted: number
  users_deleted: number
  users_anonymized: number
  duration_ms: number
}

async function cleanupEphemeralHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    logger.cronJobStart('cleanup-ephemeral', { correlationId })

    let presenceDeleted = 0
    let usersDeleted = 0
    let usersAnonymized = 0

    // Step 1: Clean up expired presence records (older than 5 minutes)
    const { error: presenceCleanupError } = await supabaseAdmin
      .rpc('cleanup_expired_presence')

    if (presenceCleanupError) {
      logger.error('Presence cleanup failed', { correlationId }, presenceCleanupError)
    } else {
      // Get the count from a separate query since RPC result handling is complex
      const { data: presenceResult } = await supabaseAdmin
        .from('presence')
        .select('session_id', { count: 'exact' })
        .lt('last_seen_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

      // Now delete them
      const { error: deletePresenceError } = await supabaseAdmin
        .from('presence')
        .delete()
        .lt('last_seen_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

      if (!deletePresenceError && presenceResult) {
        presenceDeleted = presenceResult.length || 0
      }
    }

    // Step 2: Clean up ephemeral users using the stored procedure
    const { data: userCleanupResult, error: userCleanupError } = await supabaseAdmin
      .rpc('cleanup_ephemeral_users')

    if (userCleanupError) {
      logger.error('User cleanup failed', { correlationId }, userCleanupError)
    } else if (userCleanupResult && userCleanupResult.length > 0) {
      const result = userCleanupResult[0]
      usersDeleted = result.deleted_count || 0
      usersAnonymized = result.anonymized_count || 0
    }

    const duration = Date.now() - startTime

    const response: CleanupEphemeralResponse = {
      ok: true,
      presence_deleted: presenceDeleted,
      users_deleted: usersDeleted,
      users_anonymized: usersAnonymized,
      duration_ms: duration
    }

    logger.cronJobComplete('cleanup-ephemeral', duration, {
      correlationId,
      presenceDeleted,
      usersDeleted,
      usersAnonymized
    })

    res.status(200).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    const duration = Date.now() - startTime
    
    logger.error('Ephemeral cleanup error', { 
      correlationId,
      duration
    }, err)

    res.status(500).json({ 
      error: 'Cleanup job failed',
      correlationId
    })
  }
}

export default secureHandler(cleanupEphemeralHandler, securityConfigs.worker)