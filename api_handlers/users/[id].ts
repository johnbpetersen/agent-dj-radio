import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { handleApiError } from '../../src/lib/error-tracking.js'

interface UpdateUserRequest {
  display_name: string
}

interface UserResponse {
  user: {
    id: string
    display_name: string
    banned: boolean
    created_at: string
    last_submit_at?: string | null
  }
}

async function userByIdHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()
  const { id } = req.query

  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'User ID is required' })
    return
  }

  logger.request(`/api/users/${id}`, { correlationId, method: req.method })

  try {
    if (req.method === 'GET') {
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', id)
        .single()

      if (error || !user) {
        logger.warn('User not found', { correlationId, userId: id })
        res.status(404).json({ error: 'User not found' })
        return
      }

      const response: UserResponse = {
        user: sanitizeForClient(user, [])
      }

      logger.requestComplete(`/api/users/${id}`, Date.now() - startTime, {
        correlationId,
        userId: id
      })

      res.status(200).json(response)
      return
    }

    if (req.method === 'PATCH') {
      const { display_name }: UpdateUserRequest = req.body

      if (!display_name || !display_name.trim()) {
        res.status(400).json({ error: 'Display name is required' })
        return
      }

      if (display_name.trim().length > 50) {
        res.status(400).json({ error: 'Display name too long (max 50 characters)' })
        return
      }

      // Check if user exists and is not banned
      const { data: existingUser, error: userError } = await supabaseAdmin
        .from('users')
        .select('banned')
        .eq('id', id)
        .single()

      if (userError || !existingUser) {
        logger.warn('User not found for update', { correlationId, userId: id })
        res.status(404).json({ error: 'User not found' })
        return
      }

      if (existingUser.banned) {
        res.status(403).json({ error: 'Banned users cannot update their profile' })
        return
      }

      // Update display name
      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from('users')
        .update({ display_name: display_name.trim() })
        .eq('id', id)
        .select()
        .single()

      if (updateError) {
        // Check if it's a unique constraint violation (display name taken)
        if (updateError.code === '23505') {
          res.status(409).json({ error: 'Display name already taken' })
          return
        }
        throw updateError
      }

      const response: UserResponse = {
        user: sanitizeForClient(updatedUser, [])
      }

      logger.requestComplete(`/api/users/${id}`, Date.now() - startTime, {
        correlationId,
        userId: id
      })

      res.status(200).json(response)
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    const errorResponse = handleApiError(error, 'users/[id]', { correlationId })

    logger.error('User management error', { correlationId, userId: id }, error instanceof Error ? error : new Error(String(error)))

    res.status(500).json(errorResponse)
  }
}

export default secureHandler(userByIdHandler, securityConfigs.user)