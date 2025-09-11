// POST /api/users/rename - Change display name
// Updates display name for ephemeral user with validation and rate limiting

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import { requireSessionId } from '../_shared/session.js'
import { checkSessionRateLimit } from '../../src/server/rate-limit.js'
import { validateDisplayName } from '../../src/lib/profanity.js'
import { generateNameVariants } from '../../src/lib/name-generator.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

interface UsersRenameRequest {
  new_name: string
}

interface UsersRenameResponse {
  user: {
    id: string
    display_name: string
    bio: string | null
    is_agent: boolean
  }
}

async function usersRenameHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    const sessionId = requireSessionId(req)
    const { new_name }: UsersRenameRequest = req.body || {}

    logger.request('/api/users/rename', { 
      correlationId, 
      sessionId,
      newNameLength: new_name?.length
    })

    // Check rate limiting: 1 rename per minute per session
    const rateLimitResult = checkSessionRateLimit(sessionId, 'rename', {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 1
    })

    if (!rateLimitResult.allowed) {
      logger.warn('Rename rate limit exceeded', { correlationId, sessionId })
      res.status(429).json({
        error: 'Too many rename requests',
        retry_after_seconds: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
        correlationId
      })
      return
    }

    // Validate new name
    const validationError = validateDisplayName(new_name)
    if (validationError) {
      logger.warn('Invalid new display name', { correlationId, validationError })
      res.status(400).json({ error: validationError, correlationId })
      return
    }

    const trimmedName = new_name.trim()

    // Get current user via presence
    const { data: presence, error: presenceError } = await supabaseAdmin
      .from('presence')
      .select(`
        user_id,
        user:users!inner(id, display_name, bio, is_agent, banned)
      `)
      .eq('session_id', sessionId)
      .single()

    if (presenceError || !presence?.user) {
      logger.warn('Session not found for rename', { correlationId, sessionId })
      res.status(404).json({ error: 'Session not found', correlationId })
      return
    }

    if (presence.user.banned) {
      logger.warn('Banned user attempted rename', { 
        correlationId, 
        sessionId, 
        userId: presence.user.id 
      })
      res.status(403).json({ error: 'User is banned', correlationId })
      return
    }

    // Check if name is already the same
    if (presence.user.display_name === trimmedName) {
      const response: UsersRenameResponse = {
        user: sanitizeForClient(presence.user, [])
      }
      
      res.status(200).json(response)
      return
    }

    try {
      // Attempt to update user's display name
      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from('users')
        .update({ 
          display_name: trimmedName,
          last_seen_at: new Date().toISOString()
        })
        .eq('id', presence.user.id)
        .select()
        .single()

      if (updateError) {
        if (updateError.code === '23505') {
          // Unique constraint violation - name already taken
          const variants = generateNameVariants(trimmedName, 3)
          const suggestions = [trimmedName, ...variants]

          logger.info('Display name conflict', { 
            correlationId, 
            sessionId, 
            requestedName: trimmedName,
            suggestions
          })

          res.status(409).json({
            error: 'Display name already taken',
            suggestions,
            correlationId
          })
          return
        }
        throw updateError
      }

      // Update denormalized display name in presence table
      await supabaseAdmin
        .from('presence')
        .update({ display_name: trimmedName })
        .eq('session_id', sessionId)

      const response: UsersRenameResponse = {
        user: sanitizeForClient(updatedUser, [])
      }

      logger.requestComplete('/api/users/rename', Date.now() - startTime, {
        correlationId,
        sessionId,
        userId: updatedUser.id,
        oldName: presence.user.display_name,
        newName: trimmedName
      })

      res.status(200).json(response)

    } catch (error) {
      // Handle unexpected database errors
      logger.error('Database error during rename', { 
        correlationId, 
        sessionId, 
        userId: presence.user.id 
      }, error)
      
      res.status(500).json({
        error: 'Failed to update display name',
        correlationId
      })
    }

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    logger.error('Users rename error', { correlationId }, err)

    if (err.message.includes('Missing X-Session-Id') || err.message.includes('Invalid X-Session-Id')) {
      res.status(400).json({ error: err.message, correlationId })
      return
    }

    res.status(500).json({ 
      error: 'Internal server error',
      correlationId
    })
  }
}

export default secureHandler(usersRenameHandler, securityConfigs.user)