import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './_shared/supabase'
import { upsertUser } from '../src/server/db'
import { secureHandler, securityConfigs } from './_shared/secure-handler'
import { sanitizeForClient } from './_shared/security'
import { logger, generateCorrelationId } from '../src/lib/logger'
import { handleApiError } from '../src/lib/error-tracking'

interface CreateUserRequest {
  display_name: string
}

interface CreateUserResponse {
  user: {
    id: string
    display_name: string
  }
}

async function usersHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  logger.request('/api/users', { correlationId })

  try {
    const { display_name }: CreateUserRequest = req.body

    if (!display_name || !display_name.trim()) {
      logger.warn('User creation failed - no display name', { correlationId })
      return res.status(400).json({ error: 'Display name is required' })
    }

    if (display_name.trim().length > 50) {
      logger.warn('User creation failed - display name too long', { correlationId })
      return res.status(400).json({ error: 'Display name too long (max 50 characters)' })
    }

    // Get or create user by display name
    const user = await upsertUser(supabaseAdmin, {
      display_name: display_name.trim(),
      banned: false
    })

    if (!user) {
      logger.error('Failed to create user', { correlationId })
      return res.status(500).json({ error: 'Failed to create user' })
    }

    const response: CreateUserResponse = {
      user: sanitizeForClient(user, [])
    }

    logger.requestComplete('/api/users', Date.now() - startTime, {
      correlationId,
      userId: user.id
    })

    res.status(200).json(response)
  } catch (error) {
    const errorResponse = handleApiError(error, 'users', { correlationId })

    logger.error('User creation error', { correlationId }, error instanceof Error ? error : new Error(String(error)))

    res.status(500).json(errorResponse)
  }
}

export default secureHandler(usersHandler, securityConfigs.user)