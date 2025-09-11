// GET /api/users/active - Get active users list
// Returns users seen within specified time window via presence records

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

interface ActiveUsersResponse {
  users: Array<{
    id: string
    display_name: string
    bio: string | null
    is_agent: boolean
  }>
}

async function activeUsersHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
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
    // Parse window_secs parameter (default 120 seconds = 2 minutes)
    const windowSecsParam = req.query.window_secs as string
    let windowSecs = 120 // default
    
    if (windowSecsParam) {
      const parsed = parseInt(windowSecsParam, 10)
      if (parsed > 0 && parsed <= 3600) { // Max 1 hour
        windowSecs = parsed
      }
    }

    logger.request('/api/users/active', { 
      correlationId,
      windowSecs
    })

    // Query active users via presence records
    // Use presence.last_seen_at for the window check, join to get user details
    const windowStart = new Date(Date.now() - (windowSecs * 1000)).toISOString()

    const { data: presenceRecords, error } = await supabaseAdmin
      .from('presence')
      .select(`
        user_id,
        last_seen_at,
        user:users!inner(
          id,
          display_name,
          bio,
          is_agent,
          banned
        )
      `)
      .gte('last_seen_at', windowStart)
      .order('last_seen_at', { ascending: false })
      .limit(100)

    if (error) {
      logger.error('Active users query failed', { correlationId }, error)
      res.status(500).json({ 
        error: 'Internal server error',
        correlationId
      })
      return
    }

    // Process results: exclude banned users, deduplicate by user_id, sanitize
    const userMap = new Map<string, any>()
    
    for (const record of presenceRecords || []) {
      if (!record.user || record.user.banned) {
        continue // Skip banned users
      }

      // Keep the most recent presence record per user
      const userId = record.user.id
      const existing = userMap.get(userId)
      
      if (!existing || new Date(record.last_seen_at) > new Date(existing.last_seen_at)) {
        userMap.set(userId, {
          ...record.user,
          last_seen_at: record.last_seen_at
        })
      }
    }

    // Convert to array and sanitize
    const users = Array.from(userMap.values())
      .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime())
      .map(user => sanitizeForClient(user, ['last_seen_at'])) // Remove last_seen_at from client response

    const response: ActiveUsersResponse = {
      users
    }

    logger.requestComplete('/api/users/active', Date.now() - startTime, {
      correlationId,
      userCount: users.length,
      windowSecs
    })

    res.status(200).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    logger.error('Active users error', { correlationId }, err)

    res.status(500).json({ 
      error: 'Internal server error',
      correlationId
    })
  }
}

export default secureHandler(activeUsersHandler, securityConfigs.public)