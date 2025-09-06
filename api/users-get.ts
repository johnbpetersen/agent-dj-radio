// DEV convenience route for users/[id] fallback
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './_shared/supabase'
import { secureHandler, securityConfigs } from './_shared/secure-handler'
import { sanitizeForClient } from './_shared/security'
import { logger, generateCorrelationId } from '../src/lib/logger'
import { handleApiError } from '../src/lib/error-tracking'

interface UserResponse {
  user: {
    id: string
    display_name: string
    banned: boolean
    created_at: string
    last_submit_at?: string | null
  }
}

async function usersGetHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const id = (req.query.id as string) || ''
  if (!id) {
    return res.status(400).json({ error: 'id required' })
  }

  logger.request('/api/users-get', { correlationId, method: req.method, userId: id })

  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) {
      logger.warn('User not found', { correlationId, userId: id })
      return res.status(404).json({ error: 'User not found' })
    }

    const response: UserResponse = {
      user: sanitizeForClient(data, [])
    }

    logger.requestComplete('/api/users-get', Date.now() - startTime, {
      correlationId,
      userId: id
    })

    res.status(200).json(response)
  } catch (error) {
    const errorResponse = handleApiError(error, 'users-get', { correlationId })
    
    logger.error('User fetch error', { correlationId, userId: id }, error instanceof Error ? error : new Error(String(error)))

    res.status(500).json(errorResponse)
  }
}

export default secureHandler(usersGetHandler, securityConfigs.user)