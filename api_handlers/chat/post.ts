// POST /api/chat/post - Post chat message
// Alpha chat feature behind ENABLE_CHAT_ALPHA flag

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { ensureSession, setSessionCookie } from '../_shared/session-helpers.js'
import { checkSessionRateLimit } from '../../src/server/rate-limit.js'
import { validateChatMessage } from '../../src/lib/profanity.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { httpError } from '../_shared/errors.js'

interface ChatPostRequest {
  message: string
}

interface ChatPostResponse {
  ok: boolean
}

/**
 * Compute canChat capability based on user state (unconditional)
 * Logic: !banned && !ephemeral
 */
function computeCanChat(user: { banned: boolean; ephemeral: boolean }): boolean {
  return !user.banned && !user.ephemeral
}

async function chatPostHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Check feature flags
  if (process.env.ENABLE_EPHEMERAL_USERS !== 'true') {
    res.status(404).json({ error: 'Feature not available' })
    return
  }

  if (process.env.ENABLE_CHAT_ALPHA !== 'true') {
    res.status(404).json({ error: 'Chat feature not available' })
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

    const { message }: ChatPostRequest = req.body || {}

    logger.request('/api/chat/post', {
      correlationId,
      sessionId,
      messageLength: message?.length
    })

    // Validate message first (before any DB access - cheapest check)
    const validationError = validateChatMessage(message)
    if (validationError) {
      logger.warn('Invalid chat message', { correlationId, validationError })
      res.status(422).json({ error: validationError, correlationId })
      return
    }

    const trimmedMessage = message.trim()

    // Fetch user data (identity source is sessions → users)
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

    // Check capability: can this user chat?
    const canChat = computeCanChat({
      banned: user.banned ?? false,
      ephemeral: user.ephemeral ?? true
    })

    if (!canChat) {
      // Determine specific reason for denial
      if (user.banned) {
        logger.warn('Banned user attempted chat post', {
          correlationId,
          sessionId,
          userId
        })
        throw httpError.forbidden('User is banned')
      }

      // If not banned but can't chat, must be ephemeral with flag ON
      logger.warn('Guest user attempted chat with REQUIRE_LINKED_FOR_CHAT enabled', {
        correlationId,
        sessionId,
        userId,
        ephemeral: user.ephemeral
      })
      throw httpError.chatRequiresLinked()
    }

    // Also check presence for backward compatibility (until we migrate chat fully)
    const { data: presence, error: presenceError } = await supabaseAdmin
      .from('presence')
      .select('session_id, user_id, display_name')
      .eq('session_id', sessionId)
      .single()

    if (presenceError || !presence) {
      logger.warn('Session not found in presence for chat post', { correlationId, sessionId })
      throw httpError.notFound('Session not found')
    }

    // Check rate limiting: 1 message per 2 seconds per user (after capability check)
    const rateLimitResult = checkSessionRateLimit(userId, 'chat-post', {
      windowMs: 2 * 1000, // 2 seconds
      maxRequests: 1
    })

    if (!rateLimitResult.allowed) {
      logger.warn('Chat post rate limit exceeded', {
        correlationId,
        sessionId,
        userId
      })
      throw httpError.tooManyRequests('Please wait 2 seconds between messages')
    }

    // Insert chat message with denormalized data
    const { data: insertedMessage, error: insertError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        user_id: userId,
        display_name: user.display_name,
        message: trimmedMessage
      })
      .select('id')
      .single()

    if (insertError || !insertedMessage) {
      logger.error('Failed to insert chat message', {
        correlationId,
        sessionId,
        userId
      }, insertError)

      throw httpError.internal('Failed to post message', {
        db: {
          type: 'QUERY',
          operation: 'insert',
          table: 'chat_messages'
        }
      })
    }

    // Update presence last_seen_at
    await supabaseAdmin
      .from('presence')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('session_id', sessionId)

    // Update user last_seen_at
    await supabaseAdmin
      .from('users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', userId)

    const response: ChatPostResponse = {
      ok: true
    }

    // Structured success log (no message content for privacy)
    logger.info('Chat message posted', {
      event: 'chat_posted',
      userId,
      messageId: insertedMessage.id,
      correlationId
    })

    logger.requestComplete('/api/chat/post', Date.now() - startTime, {
      correlationId,
      sessionId,
      userId,
      displayName: user.display_name,
      messageLength: trimmedMessage.length
    })

    res.status(201).json(response)

  } catch (error) {
    // All errors will be handled by secureHandler
    throw error
  }
}

export default secureHandler(chatPostHandler, securityConfigs.user)