// POST /api/users/bio - Set user bio
// Updates bio for ephemeral user with validation and rate limiting
// @ts-nocheck - TODO(types): Complex Supabase query result types need proper typing

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import { requireSessionId } from '../_shared/session.js'
import { checkSessionRateLimit } from '../../src/server/rate-limit.js'
import { containsProfanity } from '../../src/lib/profanity.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

interface UsersBioRequest {
  bio: string
}

interface UsersBioResponse {
  user: {
    id: string
    display_name: string
    bio: string | null
    is_agent: boolean
  }
}

async function usersBioHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    const { bio }: UsersBioRequest = req.body || {}

    logger.request('/api/users/bio', { 
      correlationId, 
      sessionId,
      bioLength: bio?.length
    })

    // Check rate limiting: 1 bio update per minute per session
    const rateLimitResult = checkSessionRateLimit(sessionId, 'bio', {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 1
    })

    if (!rateLimitResult.allowed) {
      logger.warn('Bio update rate limit exceeded', { correlationId, sessionId })
      res.status(429).json({
        error: 'Too many bio update requests',
        retry_after_seconds: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
        correlationId
      })
      return
    }

    // Validate bio
    if (bio !== null && bio !== undefined) {
      if (typeof bio !== 'string') {
        res.status(400).json({ 
          error: 'Bio must be a string',
          correlationId
        })
        return
      }

      if (bio.length > 200) {
        res.status(400).json({ 
          error: 'Bio too long (max 200 characters)',
          correlationId
        })
        return
      }

      if (containsProfanity(bio)) {
        res.status(400).json({ 
          error: 'Bio contains inappropriate content',
          correlationId
        })
        return
      }
    }

    const trimmedBio = bio?.trim() || null
    const finalBio = trimmedBio === '' ? null : trimmedBio

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
      logger.warn('Session not found for bio update', { correlationId, sessionId })
      res.status(404).json({ error: 'Session not found', correlationId })
      return
    }

    if (presence.user.banned) {
      logger.warn('Banned user attempted bio update', { 
        correlationId, 
        sessionId, 
        userId: presence.user.id 
      })
      res.status(403).json({ error: 'User is banned', correlationId })
      return
    }

    // Check if bio is already the same
    if (presence.user.bio === finalBio) {
      const response: UsersBioResponse = {
        user: sanitizeForClient(presence.user, [])
      }
      
      res.status(200).json(response)
      return
    }

    // Update user's bio
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('users')
      .update({ 
        bio: finalBio,
        last_seen_at: new Date().toISOString()
      })
      .eq('id', presence.user.id)
      .select()
      .single()

    if (updateError) {
      logger.error('Failed to update user bio', { 
        correlationId, 
        sessionId, 
        userId: presence.user.id 
      }, updateError)
      
      res.status(500).json({
        error: 'Failed to update bio',
        correlationId
      })
      return
    }

    const response: UsersBioResponse = {
      user: sanitizeForClient(updatedUser, [])
    }

    logger.requestComplete('/api/users/bio', Date.now() - startTime, {
      correlationId,
      sessionId,
      userId: updatedUser.id,
      bioLength: finalBio?.length || 0
    })

    res.status(200).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    logger.error('Users bio error', { correlationId }, err)

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

export default secureHandler(usersBioHandler, securityConfigs.user)