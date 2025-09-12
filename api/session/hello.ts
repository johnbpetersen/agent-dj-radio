// POST /api/session/hello - Create/retrieve ephemeral user + presence
// Creates ephemeral user and presence for session-based authentication

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import { requireSessionId } from '../_shared/session.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { generateFunName, generateNameVariants } from '../../src/lib/name-generator.js'
import { validateDisplayName } from '../../src/lib/profanity.js'

interface SessionHelloRequest {
  display_name?: string
}

interface SessionHelloResponse {
  user: {
    id: string
    display_name: string
    bio: string | null
    is_agent: boolean
  }
  session_id: string
}

async function sessionHelloHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    const { display_name }: SessionHelloRequest = req.body || {}

    logger.request('/api/session/hello', { 
      correlationId, 
      sessionId,
      hasDisplayName: !!display_name
    })

    // Check if presence already exists for this session
    const { data: existingPresence } = await supabaseAdmin
      .from('presence')
      .select(`
        *,
        user:users(id, display_name, bio, is_agent, banned)
      `)
      .eq('session_id', sessionId)
      .single()

    if (existingPresence?.user && !existingPresence.user.banned) {
      // Update timestamps and return existing user
      await Promise.all([
        supabaseAdmin
          .from('presence')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('session_id', sessionId),
        supabaseAdmin
          .from('users')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', existingPresence.user.id)
      ])

      const response: SessionHelloResponse = {
        user: sanitizeForClient(existingPresence.user, []),
        session_id: sessionId
      }

      logger.requestComplete('/api/session/hello', Date.now() - startTime, {
        correlationId,
        userId: existingPresence.user.id,
        action: 'existing_session'
      })

      res.status(200).json(response)
      return
    }

    // Create new ephemeral user
    let finalDisplayName = display_name?.trim() || generateFunName()
    
    // Validate display name
    const validationError = validateDisplayName(finalDisplayName)
    if (validationError) {
      logger.warn('Invalid display name', { correlationId, validationError })
      res.status(400).json({ error: validationError })
      return
    }

    let user: any = null
    let attempts = 0
    const maxAttempts = 5

    while (!user && attempts < maxAttempts) {
      attempts++
      
      try {
        // Try to create user with current name
        const { data: newUser, error: userError } = await supabaseAdmin
          .from('users')
          .insert({
            display_name: finalDisplayName,
            banned: false,
            is_agent: false,
            bio: null,
            last_seen_at: new Date().toISOString(),
            ephemeral: true
          })
          .select()
          .single()

        if (newUser) {
          user = newUser
          break
        }

        if (userError?.code === '23505') {
          // Unique constraint violation - try variants
          if (attempts === 1) {
            // First retry: try numbered variants
            const variants = generateNameVariants(finalDisplayName, 3)
            const suggestions = [finalDisplayName, ...variants]
            
            res.status(409).json({
              error: 'Display name already taken',
              suggestions
            })
            return
          } else {
            // Subsequent retries: generate new fun name
            finalDisplayName = generateFunName()
          }
        } else {
          throw userError
        }
      } catch (error) {
        if (attempts >= maxAttempts) {
          throw error
        }
        // Continue to next attempt
      }
    }

    if (!user) {
      throw new Error('Failed to create user after multiple attempts')
    }

    // Create presence record (upsert to prevent duplicate key errors)
    const { error: presenceError } = await supabaseAdmin
      .from('presence')
      .upsert({
        session_id: sessionId,
        user_id: user.id,
        display_name: user.display_name,
        last_seen_at: new Date().toISOString(),
        user_agent: req.headers['user-agent'] || null,
        ip: req.headers['x-forwarded-for']?.toString()?.split(',')[0] || 
            req.headers['x-real-ip']?.toString() || null
      }, { 
        onConflict: 'session_id', 
        ignoreDuplicates: false 
      })

    if (presenceError) {
      logger.error('Failed to create presence', { correlationId }, presenceError)
      // Continue anyway - user creation succeeded
    }

    const response: SessionHelloResponse = {
      user: sanitizeForClient(user, []),
      session_id: sessionId
    }

    logger.requestComplete('/api/session/hello', Date.now() - startTime, {
      correlationId,
      userId: user.id,
      displayName: user.display_name,
      action: 'new_user'
    })

    res.status(201).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    logger.error('Session hello error', { correlationId }, err)

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

export default secureHandler(sessionHelloHandler, securityConfigs.user)