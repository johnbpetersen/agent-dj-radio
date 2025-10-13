// POST /api/chat/post - Post chat message
// Alpha chat feature behind ENABLE_CHAT_ALPHA flag

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { requireSessionId } from '../_shared/session.js'
import { checkSessionRateLimit } from '../../src/server/rate-limit.js'
import { validateChatMessage } from '../../src/lib/profanity.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

interface ChatPostRequest {
  message: string
}

interface ChatPostResponse {
  ok: boolean
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
    const sessionId = requireSessionId(req)
    const { message }: ChatPostRequest = req.body || {}

    logger.request('/api/chat/post', { 
      correlationId, 
      sessionId,
      messageLength: message?.length
    })

    // Validate message first (before rate limit check - cheaper)
    const validationError = validateChatMessage(message)
    if (validationError) {
      logger.warn('Invalid chat message', { correlationId, validationError })
      res.status(422).json({ error: validationError, correlationId }) // 422 for validation errors
      return
    }

    // Check rate limiting: 1 message per 2 seconds per user (stricter than before)
    const rateLimitResult = checkSessionRateLimit(presence.user_id, 'chat-post', {
      windowMs: 2 * 1000, // 2 seconds
      maxRequests: 1
    })

    if (!rateLimitResult.allowed) {
      logger.warn('Chat post rate limit exceeded', {
        correlationId,
        sessionId,
        userId: presence.user_id
      })
      res.status(429).json({
        error: 'Too many messages',
        message: 'Please wait 2 seconds between messages',
        retry_after_seconds: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
        correlationId
      })
      return
    }

    const trimmedMessage = message.trim()

    // Get current user and presence via session
    const { data: presence, error: presenceError } = await supabaseAdmin
      .from('presence')
      .select(`
        session_id,
        user_id,
        display_name,
        user:users!inner(id, display_name, banned)
      `)
      .eq('session_id', sessionId)
      .single()

    if (presenceError || !presence?.user) {
      logger.warn('Session not found for chat post', { correlationId, sessionId })
      res.status(404).json({ error: 'Session not found', correlationId })
      return
    }

    if (presence.user.banned) {
      logger.warn('Banned user attempted chat post', {
        correlationId,
        sessionId,
        userId: presence.user.id
      })
      res.status(403).json({ error: 'User is banned', correlationId })
      return
    }

    // Check if user has Discord linked (chat requires Discord)
    const { data: discordAccount, error: discordError } = await supabaseAdmin
      .from('user_accounts')
      .select('id')
      .eq('user_id', presence.user_id)
      .eq('provider', 'discord')
      .single()

    if (discordError && discordError.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is expected for guests
      logger.error('Error checking Discord account', { correlationId }, discordError)
      res.status(500).json({
        error: 'Internal server error',
        correlationId
      })
      return
    }

    if (!discordAccount) {
      logger.warn('Guest attempted chat post without Discord', {
        correlationId,
        sessionId,
        userId: presence.user_id
      })
      res.status(403).json({
        error: 'Discord account required',
        message: 'Please sign in with Discord to use chat',
        correlationId
      })
      return
    }

    // Insert chat message with denormalized data
    const { error: insertError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        user_id: presence.user_id,
        display_name: presence.display_name, // Use presence display name (most current)
        message: trimmedMessage
      })

    if (insertError) {
      logger.error('Failed to insert chat message', { 
        correlationId, 
        sessionId, 
        userId: presence.user_id 
      }, insertError)
      
      res.status(500).json({
        error: 'Failed to post message',
        correlationId
      })
      return
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
      .eq('id', presence.user_id)

    const response: ChatPostResponse = {
      ok: true
    }

    logger.requestComplete('/api/chat/post', Date.now() - startTime, {
      correlationId,
      sessionId,
      userId: presence.user_id,
      displayName: presence.display_name,
      messageLength: trimmedMessage.length
    })

    res.status(201).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    logger.error('Chat post error', { correlationId }, err)

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

export default secureHandler(chatPostHandler, securityConfigs.user)