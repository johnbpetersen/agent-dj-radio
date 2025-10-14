// GET /api/session/whoami - Development debugging endpoint
// Returns current session information for troubleshooting
// DEV ONLY - returns 404 in production

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { requireSessionId } from '../_shared/session.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

interface WhoamiResponse {
  userId: string
  displayName: string
  isDiscordLinked: boolean
  isWalletLinked: boolean
  sessionId: string
  presenceExists: boolean
  ephemeralDisplayName: string | null
}

async function whoamiHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // DEV ONLY - return 404 in production
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' })
    return
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const correlationId = generateCorrelationId()

  try {
    // Get session ID from cookie/header
    const sessionId = requireSessionId(req)

    logger.debug('/api/session/whoami', { correlationId, sessionId })

    // Get presence data
    const { data: presence } = await supabaseAdmin
      .from('presence')
      .select('user_id, display_name')
      .eq('session_id', sessionId)
      .single()

    if (!presence) {
      res.status(200).json({
        sessionId,
        presenceExists: false,
        message: 'Session ID valid but no presence record found'
      })
      return
    }

    // Get user data
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, ephemeral_display_name')
      .eq('id', presence.user_id)
      .single()

    if (!user) {
      res.status(200).json({
        sessionId,
        presenceExists: true,
        userId: presence.user_id,
        message: 'Presence exists but user not found (orphaned session)'
      })
      return
    }

    // Check Discord link
    const { data: discordAccount } = await supabaseAdmin
      .from('user_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'discord')
      .single()

    // Check wallet binding
    const { data: walletAccount } = await supabaseAdmin
      .from('user_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'wallet')
      .single()

    const response: WhoamiResponse = {
      userId: user.id,
      displayName: user.display_name,
      isDiscordLinked: !!discordAccount,
      isWalletLinked: !!walletAccount,
      sessionId,
      presenceExists: true,
      ephemeralDisplayName: user.ephemeral_display_name
    }

    res.status(200).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    if (err.message.includes('Missing X-Session-Id')) {
      res.status(200).json({
        error: 'No session cookie or header found',
        message: 'Check that x_session_id cookie is set or X-Session-Id header is present'
      })
      return
    }

    logger.error('Whoami error', { correlationId }, err)
    res.status(500).json({
      error: 'Internal server error',
      correlationId
    })
  }
}

export default secureHandler(whoamiHandler, securityConfigs.public)
