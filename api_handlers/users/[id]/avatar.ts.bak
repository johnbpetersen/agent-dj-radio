// GET /api/users/[id]/avatar - Get user's Discord avatar URL
// Returns avatar URL from Discord if linked, null otherwise
// Always returns 200 with { avatar_url: string | null } - never 404

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'

interface AvatarResponse {
  avatar_url: string | null
}

async function userAvatarHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Set Cache-Control header immediately for all response paths
  const maxAge = parseInt(process.env.AVATAR_CACHE_MAX_AGE_SEC || '300', 10)
  res.setHeader('Cache-Control', `public, max-age=${maxAge}`)

  const correlationId = generateCorrelationId()

  try {
    // Extract user ID from path: /api/users/[id]/avatar
    const userId = req.query.id as string

    if (!userId) {
      // Invalid request - but still return 200 with null to avoid 404 spam
      logger.debug('Avatar request missing user ID', { correlationId })
      const response: AvatarResponse = { avatar_url: null }
      res.status(200).json(response)
      return
    }

    // UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId)) {
      // Invalid UUID - return 200 with null
      logger.debug('Avatar request with invalid UUID format', { correlationId, userId })
      const response: AvatarResponse = { avatar_url: null }
      res.status(200).json(response)
      return
    }

    logger.request('/api/users/[id]/avatar', { correlationId, userId })

    // Call SQL function to get Discord avatar URL
    const { data, error } = await supabaseAdmin.rpc('get_discord_avatar_url', {
      p_user_id: userId,
      p_size: 64
    })

    if (error) {
      // RPC error - user not found or not linked, return null
      logger.debug('Discord avatar RPC returned error (expected for unlinked users)', {
        correlationId,
        userId,
        error: error.message
      })
      const response: AvatarResponse = { avatar_url: null }
      res.status(200).json(response)
      return
    }

    const response: AvatarResponse = {
      avatar_url: data || null
    }

    logger.requestComplete('/api/users/[id]/avatar', 0, {
      correlationId,
      userId,
      hasAvatar: !!data
    })

    res.status(200).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.warn('Avatar endpoint unexpected error', { correlationId }, err)

    // Graceful degradation - return null avatar (still 200)
    const response: AvatarResponse = { avatar_url: null }
    res.status(200).json(response)
  }
}

export default secureHandler(userAvatarHandler, securityConfigs.public)
