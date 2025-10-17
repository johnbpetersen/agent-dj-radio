// GET/POST /api/session/hello - Create/retrieve ephemeral user + presence
// Creates ephemeral user and presence for session-based authentication
// Supports both GET and POST for idempotent session initialization

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import { getSessionId } from '../_shared/session-helpers.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { generateFunName, generateNameVariants } from '../../src/lib/name-generator.js'
import { validateDisplayName } from '../../src/lib/profanity.js'
import { httpError, type ErrorMeta } from '../_shared/errors.js'
import { computeIdentityPayload, type Identity } from '../_shared/identity.js'

interface SessionHelloRequest {
  display_name?: string
}

interface SessionHelloResponse {
  user: {
    id: string
    display_name: string
    bio: string | null
    is_agent: boolean
    kind: string
    isWalletLinked: boolean
  }
  identity: Identity
  session_id: string
}

async function sessionHelloHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Accept both GET and POST (idempotent cookie-based session init)
  if (req.method !== 'GET' && req.method !== 'POST') {
    throw httpError.badRequest('Method not allowed', 'Only GET and POST requests are supported')
  }

  // Check feature flag
  if (process.env.ENABLE_EPHEMERAL_USERS !== 'true') {
    throw httpError.notFound('Feature not available', 'Ephemeral users feature is disabled')
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  try {
    // Get existing session ID from header or cookie (don't create new one yet)
    const sessionId = getSessionId(req)
    const { display_name }: SessionHelloRequest = req.body || {}

    logger.request('/api/session/hello', {
      correlationId,
      sessionId: sessionId || 'will_create',
      hasDisplayName: !!display_name
    })

    // If session exists, check for presence
    let existingPresence = null
    if (sessionId) {
      const { data } = await supabaseAdmin
        .from('presence')
        .select(`
          *,
          user:users(id, display_name, bio, is_agent, banned, kind)
        `)
        .eq('session_id', sessionId)
        .single()

      existingPresence = data
    }

    if (existingPresence?.user && !existingPresence.user.banned && sessionId) {
      // Import helper to set cookie if needed
      const { parseCookies, setSessionCookie } = await import('../_shared/session-helpers.js')

      // Ensure cookie is set even if session came from header
      const cookies = parseCookies(req)
      if (!cookies.sid) {
        setSessionCookie(res, sessionId, req)
      }

      // Update timestamps and return existing user
      await Promise.all([
        supabaseAdmin
          .from('presence')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('session_id', sessionId),
        supabaseAdmin
          .from('users')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', existingPresence.user.id)
      ])

      // Check for linked accounts (wallet)
      const { data: userAccounts } = await supabaseAdmin
        .from('user_accounts')
        .select('provider, meta')
        .eq('user_id', existingPresence.user.id)

      const isWalletLinked = userAccounts?.some(acc => acc.provider === 'wallet') ?? false

      // Compute identity payload
      const identity = await computeIdentityPayload(existingPresence.user, userAccounts || [])

      const response: SessionHelloResponse = {
        user: {
          ...sanitizeForClient(existingPresence.user, []),
          isWalletLinked
        },
        identity,
        session_id: sessionId
      }

      logger.requestComplete('/api/session/hello', Date.now() - startTime, {
        correlationId,
        userId: existingPresence.user.id,
        action: 'existing_session',
        isWalletLinked
      })

      res.status(200).json(response)
      return
    }

    // Create new session and ephemeral user
    // Generate a new session ID if we don't have one
    const newSessionId = sessionId || generateCorrelationId()

    // Import helper to set cookie
    const { setSessionCookie: setCookie } = await import('../_shared/session-helpers.js')
    setCookie(res, newSessionId, req)

    let finalDisplayName = display_name?.trim() || generateFunName()
    
    // Validate display name
    const validationError = validateDisplayName(finalDisplayName)
    if (validationError) {
      logger.warn('Invalid display name', { correlationId, validationError })
      throw httpError.badRequest(validationError, 'Please choose a different display name')
    }

    let user: Record<string, unknown> | null = null
    let attempts = 0
    const maxAttempts = 5

    while (!user && attempts < maxAttempts) {
      attempts++
      
      try {
        // Try to create user with current name
        const { data: newUser, error: userError } = await supabaseAdmin
          .from('users')
          .insert({
            display_name: finalDisplayName,
            banned: false,
            is_agent: false,
            bio: null,
            last_seen_at: new Date().toISOString(),
            ephemeral: true
          })
          .select()
          .single()

        if (newUser) {
          user = newUser
          break
        }

        if (userError?.code === '23505') {
          // Unique constraint violation - try variants
          if (attempts === 1) {
            // First retry: try numbered variants
            generateNameVariants(finalDisplayName, 3)

            throw httpError.badRequest('Display name already taken', undefined, {
              context: {
                route: '/api/session/hello',
                method: 'POST',
                path: req.url,
                queryKeysOnly: req.query ? Object.keys(req.query) : [],
                targetUrl: 'supabase://users'
              }
            })
          } else {
            // Subsequent retries: generate new fun name
            finalDisplayName = generateFunName()
          }
        } else {
          const context: ErrorMeta['context'] = {
            route: '/api/session/hello',
            method: 'POST',
            path: req.url,
            queryKeysOnly: req.query ? Object.keys(req.query) : [],
            targetUrl: 'supabase://users'
          }
          logger.error('User creation failed', { correlationId, ...context }, userError)
          throw httpError.dbError('Failed to create user', {
            db: { type: 'QUERY', operation: 'insert', table: 'users' },
            context
          })
        }
      } catch (error) {
        if (attempts >= maxAttempts) {
          throw error
        }
        // Continue to next attempt
      }
    }

    if (!user) {
      throw httpError.internal('Failed to create user after multiple attempts')
    }

    // Create presence record (upsert to prevent duplicate key errors)
    const { error: presenceError } = await supabaseAdmin
      .from('presence')
      .upsert({
        session_id: newSessionId,
        user_id: user.id,
        display_name: user.display_name,
        last_seen_at: new Date().toISOString(),
        user_agent: req.headers['user-agent'] || null,
        ip: req.headers['x-forwarded-for']?.toString()?.split(',')[0] ||
            req.headers['x-real-ip']?.toString() || null
      }, {
        onConflict: 'session_id',
        ignoreDuplicates: false
      })

    if (presenceError) {
      const context: ErrorMeta['context'] = {
        route: '/api/session/hello',
        method: 'POST',
        path: req.url,
        queryKeysOnly: req.query ? Object.keys(req.query) : [],
        targetUrl: 'supabase://presence'
      }
      logger.error('Failed to create presence', { correlationId, ...context }, presenceError)
      // Continue anyway - user creation succeeded
    }

    // New users don't have linked accounts yet
    // Compute identity payload for new user
    const identity = await computeIdentityPayload(user as any, [])

    const response: SessionHelloResponse = {
      user: {
        ...sanitizeForClient(user, []),
        isWalletLinked: false
      },
      identity,
      session_id: newSessionId
    }

    logger.requestComplete('/api/session/hello', Date.now() - startTime, {
      correlationId,
      userId: user.id,
      displayName: user.display_name,
      action: 'new_user',
      sidSuffix: newSessionId.slice(-6)
    })

    res.status(201).json(response)

  } catch (error) {
    // All errors will be handled by secureHandler
    throw error
  }
}

export default secureHandler(sessionHelloHandler, securityConfigs.user)