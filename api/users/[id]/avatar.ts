// GET /api/users/[id]/avatar - Get user's Discord avatar URL
// Returns avatar URL from Discord if linked, null otherwise

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

  const correlationId = generateCorrelationId()

  try {
    // Extract user ID from path: /api/users/[id]/avatar
    const userId = req.query.id as string

    if (!userId) {
      res.status(400).json({ error: 'User ID is required' })
      return
    }

    // UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId)) {
      res.status(400).json({ error: 'Invalid user ID format' })
      return
    }

    logger.request('/api/users/[id]/avatar', { correlationId, userId })

    // Call SQL function to get Discord avatar URL
    const { data, error } = await supabaseAdmin.rpc('get_discord_avatar_url', {
      p_user_id: userId,
      p_size: 64
    })

    if (error) {
      logger.error('Failed to get Discord avatar URL', { correlationId, userId }, error)
      // Return null instead of error - this is expected for guests
      const response: AvatarResponse = { avatar_url: null }
      res.setHeader('Cache-Control', 'public, max-age=300')
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

    // Cache avatar responses for 5 minutes to reduce refetch storms
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.status(200).json(response)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Avatar endpoint error', { correlationId }, err)

    // Graceful degradation - return null avatar
    const response: AvatarResponse = { avatar_url: null }
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.status(200).json(response)
  }
}

export default secureHandler(userAvatarHandler, securityConfigs.public)
