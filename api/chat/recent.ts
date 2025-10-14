// GET /api/chat/recent - Get recent chat messages
// Alpha chat feature behind ENABLE_CHAT_ALPHA flag

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

interface ChatMessage {
  id: string
  user_id: string
  display_name: string
  message: string
  created_at: string
}

interface ChatRecentResponse {
  messages: ChatMessage[]
}

async function chatRecentHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
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
    // Parse limit parameter (default 50, max 100)
    const limitParam = req.query.limit as string
    let limit = 50 // default
    
    if (limitParam) {
      const parsed = parseInt(limitParam, 10)
      if (parsed > 0 && parsed <= 100) {
        limit = parsed
      }
    }

    logger.request('/api/chat/recent', { 
      correlationId,
      limit
    })

    // Query recent chat messages, ordered by created_at desc
    const { data: messages, error } = await supabaseAdmin
      .from('chat_messages')
      .select(`
        id,
        user_id,
        display_name,
        message,
        created_at
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      logger.error('Recent chat messages query failed', { correlationId }, error)
      res.status(500).json({ 
        error: 'Internal server error',
        correlationId
      })
      return
    }

    // Return messages in chronological order (oldest first) for chat display
    const orderedMessages = (messages || []).reverse()

    const response: ChatRecentResponse = {
      messages: orderedMessages
    }

    logger.requestComplete('/api/chat/recent', Date.now() - startTime, {
      correlationId,
      messageCount: orderedMessages.length,
      limit
    })

    res.status(200).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    logger.error('Chat recent error', { correlationId }, err)

    res.status(500).json({ 
      error: 'Internal server error',
      correlationId
    })
  }
}

export default secureHandler(chatRecentHandler, securityConfigs.public)