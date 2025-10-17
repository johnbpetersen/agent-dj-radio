// POST /api/users/rename - Change display name with collision safety
// Identity comes from durable sessions (never presence)
// Returns 409 on collision (no auto-suffix), 200 on no-op (same name)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { ensureSession, setSessionCookie } from '../_shared/session-helpers.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { httpError } from '../_shared/errors.js'
import { checkRenameRateLimit } from '../_shared/rate-limit.js'

interface RenameRequest {
  displayName: string
}

interface RenameResponse {
  userId: string
  displayName: string
}

/**
 * Validate display name against rules:
 * - Must be trimmed (no leading/trailing whitespace)
 * - Length: 3-24 characters
 * - Pattern: lowercase letters, digits, underscores only
 */
function validateDisplayName(displayName: string): void {
  // Check if value exists
  if (!displayName || displayName.length === 0) {
    throw httpError.badRequest('Display name is required')
  }

  // Check for whitespace
  const trimmed = displayName.trim()
  if (trimmed !== displayName) {
    throw httpError.badRequest('Display name cannot contain leading or trailing whitespace')
  }

  // Check length
  if (displayName.length < 3) {
    throw httpError.badRequest('Display name must be at least 3 characters')
  }

  if (displayName.length > 24) {
    throw httpError.badRequest('Display name must be at most 24 characters')
  }

  // Check pattern: lowercase letters, digits, underscores only
  const validPattern = /^[a-z0-9_]+$/
  if (!validPattern.test(displayName)) {
    throw httpError.badRequest(
      'Display name can only contain lowercase letters, numbers, and underscores'
    )
  }
}

async function renameHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // POST-only endpoint
  if (req.method !== 'POST') {
    throw httpError.badRequest('Method not allowed', 'Only POST requests are supported')
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  try {
    // Get user identity from durable session
    const { userId, sessionId, shouldSetCookie } = await ensureSession(req, res)

    if (shouldSetCookie) {
      setSessionCookie(res, sessionId, req)
    }

    // Check rate limit (optional, dev-only)
    if (!checkRenameRateLimit(userId)) {
      throw httpError.tooManyRequests('Too many rename attempts', {
        code: 'RATE_LIMITED'
      })
    }

    // Extract and validate display name
    const body = req.body as RenameRequest
    const { displayName } = body

    validateDisplayName(displayName)

    // Fetch current user state (identity source: sessions → users, NOT presence)
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, banned')
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

    // Guard: banned users cannot rename
    if (user.banned) {
      throw httpError.forbidden('Banned users cannot change display name')
    }

    // No-op: renaming to current name (case-sensitive match)
    if (displayName === user.display_name) {
      logger.requestComplete('/api/users/rename', Date.now() - startTime, {
        correlationId,
        userId,
        noOp: true
      })

      const response: RenameResponse = {
        userId,
        displayName
      }

      res.status(200).json(response)
      return
    }

    // Attempt to update display name
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ display_name: displayName })
      .eq('id', userId)

    if (updateError) {
      // Postgres unique constraint violation (23505) → name already taken
      if (updateError.code === '23505') {
        throw httpError.conflict('Display name already taken', {
          code: 'NAME_TAKEN'
        })
      }

      // Other DB errors
      throw httpError.internal('Failed to update display name', {
        db: {
          type: 'QUERY',
          operation: 'update',
          table: 'users'
        }
      })
    }

    logger.requestComplete('/api/users/rename', Date.now() - startTime, {
      correlationId,
      userId,
      oldName: user.display_name,
      newName: displayName
    })

    const response: RenameResponse = {
      userId,
      displayName
    }

    res.status(200).json(response)

  } catch (error) {
    // All errors will be handled by secureHandler
    throw error
  }
}

export default secureHandler(renameHandler, securityConfigs.user)
