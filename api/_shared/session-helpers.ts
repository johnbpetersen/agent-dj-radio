// api/_shared/session-helpers.ts
// Session cookie management utilities for durable user sessions

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './supabase.js'
import { generateCorrelationId } from '../../src/lib/logger.js'
import { httpError } from './errors.js'
import * as crypto from 'crypto'

/**
 * Debug session logging helper
 * Only logs when DEBUG_OAUTH=1 environment variable is set (legacy name preserved)
 * Never logs sensitive data (tokens, secrets, full bodies)
 */
export function debugOAuth(message: string, context?: Record<string, unknown>): void {
  if (process.env.DEBUG_OAUTH === '1') {
    console.log(`[DEBUG_SESSION] ${message}`, context ? JSON.stringify(context, null, 2) : '')
  }
}

/**
 * Parse Cookie header into key-value object
 * Handles malformed/missing cookies gracefully
 */
export function parseCookies(req: VercelRequest): Record<string, string> {
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) return {}

  const cookies: Record<string, string> = {}

  try {
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...valueParts] = cookie.split('=')
      if (name && valueParts.length > 0) {
        cookies[name.trim()] = valueParts.join('=').trim()
      }
    })
  } catch (err) {
    console.warn('Failed to parse cookies:', err)
  }

  return cookies
}

/**
 * Get session ID from X-Session-Id header or sid cookie
 * Priority: header > cookie > null
 */
export function getSessionId(req: VercelRequest): string | null {
  // Try header first (for fetch API clients)
  const headerSid = req.headers['x-session-id'] as string
  if (headerSid) return headerSid

  // Fallback to cookie (for browser navigation)
  const cookies = parseCookies(req)
  return cookies.sid || null
}

/**
 * Check if request is over HTTPS
 * Uses x-forwarded-proto (Vercel standard) or NODE_ENV
 * Handles comma-separated proto lists (e.g., "https,http")
 */
export function isHttps(req: VercelRequest): boolean {
  const proto = req.headers['x-forwarded-proto'] as string | undefined
  if (proto) {
    // Handle comma-separated lists - use first value
    const firstProto = proto.split(',')[0].trim()
    return firstProto === 'https'
  }

  // Fallback: assume production is HTTPS
  return process.env.NODE_ENV === 'production'
}

/**
 * Set session cookie with secure attributes
 * - httpOnly: Prevents JavaScript access
 * - SameSite=Lax: Allows top-level navigation
 * - Secure: Only sent over HTTPS (when isHttps returns true)
 * - Path=/: Available to all routes
 * - Max-Age: 2592000 (30 days)
 * - No Domain: Host-only (most secure)
 */
export function setSessionCookie(
  res: VercelResponse,
  sid: string,
  req: VercelRequest
): void {
  const maxAgeSeconds = 2592000 // 30 days

  const secure = isHttps(req) ? 'Secure; ' : ''
  const cookieValue = `sid=${sid}; HttpOnly; SameSite=Lax; ${secure}Path=/; Max-Age=${maxAgeSeconds}`

  // Preserve existing Set-Cookie headers
  const existing = res.getHeader('Set-Cookie')
  if (existing) {
    const cookies = Array.isArray(existing) ? existing : [String(existing)]
    res.setHeader('Set-Cookie', [...cookies, cookieValue])
  } else {
    res.setHeader('Set-Cookie', cookieValue)
  }
}

/**
 * Validate UUID v4 format
 */
function isValidUuid(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(value)
}

/**
 * Generate cryptographically random suffix for display names
 * Uses crypto.randomBytes for stronger randomness than Math.random()
 *
 * @param length - Length of suffix (default 5)
 * @returns base36 string (e.g., "a7f3k")
 */
function generateRandomSuffix(length = 5): string {
  const bytes = crypto.randomBytes(Math.ceil(length * 0.75)) // ~4 bytes for 5 chars
  const num = parseInt(bytes.toString('hex'), 16)
  return num.toString(36).slice(0, length).padEnd(length, '0')
}

/**
 * Create guest user with collision-safe retry logic
 * Retries with randomized suffix on 23505 unique constraint violations
 *
 * Strategy:
 * - First attempt: clean {adjective}_{animal} name
 * - Subsequent attempts: {adjective}_{animal}_{cryptoRandom5}
 * - Max 6 attempts (8×8 base names × 36^5 suffixes = massive namespace)
 *
 * @param maxAttempts - Maximum retry attempts (default 6)
 * @returns Created user { id, display_name }
 * @throws httpError.internal() if all retries exhausted or non-collision DB error
 */
async function createGuestUserWithUniqueName(
  maxAttempts = 6
): Promise<{ id: string; display_name: string }> {
  const adjectives = ['purple', 'dancing', 'happy', 'cosmic', 'electric', 'quantum', 'stellar', 'lunar']
  const animals = ['raccoon', 'penguin', 'dolphin', 'falcon', 'phoenix', 'dragon', 'octopus', 'panda']
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)]
  const animal = animals[Math.floor(Math.random() * animals.length)]
  const baseName = `${adjective}_${animal}`

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const userId = generateCorrelationId()
    const displayName = attempt === 0
      ? baseName
      : `${baseName}_${generateRandomSuffix()}`

    const { data, error } = await supabaseAdmin
      .from('users')
      .insert({
        id: userId,
        display_name: displayName,
        ephemeral: true,
        banned: false
      })
      .select('id, display_name')
      .single()

    if (!error) {
      debugOAuth('guest-user-created', {
        attempt: attempt + 1,
        hadCollision: attempt > 0
      })
      return data
    }

    // Unique constraint violation (Postgres 23505) - retry with suffix
    if (error.code === '23505') {
      debugOAuth('guest-name-collision', {
        attempt: attempt + 1,
        baseName,
        willRetry: attempt < maxAttempts - 1
      })
      continue
    }

    // Any other DB error - fail immediately with wrapped error
    throw httpError.internal('Failed to create guest user', {
      db: {
        type: 'QUERY',
        operation: 'insert_user',
        table: 'users'
      }
    })
  }

  // Exhausted all retries
  throw httpError.internal('Failed to create guest user after retries', {
    db: {
      type: 'QUERY',
      operation: 'insert_user',
      table: 'users'
    }
  })
}

/**
 * Ensure session exists and return userId + sessionId
 * Uses durable sessions table as source of truth for identity
 * Presence is upserted but NOT queried for identity
 *
 * Flow:
 * 1. Get sid from cookie/header (or generate new)
 * 2. Lookup sessions table by session_id
 * 3. If found: update last_seen_at, upsert presence, return userId
 * 4. If not found: create user → insert session → upsert presence → set cookie
 *
 * Race safety: Primary key constraint on session_id handles concurrent inserts
 *
 * @param req - Vercel request
 * @param res - Vercel response (for setting cookie)
 * @returns { userId, sessionId, shouldSetCookie } - Session info
 */
export async function ensureSession(
  req: VercelRequest,
  _res: VercelResponse
): Promise<{ userId: string; sessionId: string; shouldSetCookie: boolean }> {
  let sid = getSessionId(req)

  // Validate existing sid (treat invalid UUID as missing)
  if (sid && !isValidUuid(sid)) {
    debugOAuth('invalid-uuid-in-cookie', { sidPrefix: sid.slice(0, 8) })
    sid = null
  }

  const now = new Date().toISOString()

  // If sid exists, lookup in sessions table
  if (sid) {
    const { data: existingSession, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .select('session_id, user_id')
      .eq('session_id', sid)
      .single()

    if (existingSession) {
      // Session found! Update last_seen_at
      await supabaseAdmin
        .from('sessions')
        .update({ last_seen_at: now })
        .eq('session_id', sid)

      // Get user display_name for presence upsert
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('display_name')
        .eq('id', existingSession.user_id)
        .single()

      // Upsert presence (presence is ephemeral, NOT identity source)
      await supabaseAdmin
        .from('presence')
        .upsert({
          session_id: sid,
          user_id: existingSession.user_id,
          display_name: user?.display_name || 'guest',
          last_seen_at: now
        }, {
          onConflict: 'session_id'
        })

      debugOAuth('session-hit', {
        sidSuffix: sid.slice(-6),
        userId: existingSession.user_id
      })

      // Check if cookie needs to be set (came from header)
      const cookies = parseCookies(req)
      const shouldSetCookie = !cookies.sid

      return {
        userId: existingSession.user_id,
        sessionId: sid,
        shouldSetCookie
      }
    }

    // Session not found in DB but sid was present
    if (sessionError?.code !== 'PGRST116') {
      // Unexpected error
      debugOAuth('session-lookup-error', {
        sidSuffix: sid.slice(-6),
        errorCode: sessionError?.code
      })
    } else {
      // Session mapping missing (data loss scenario)
      console.warn('[session-mapping-missing] Cookie present but no session row', {
        sidSuffix: sid.slice(-6)
      })
    }

    // Fall through to create new session with new user
    // (Cannot recover old identity without the sessions row)
  }

  // Create new session + user + presence
  sid = sid || generateCorrelationId() // Reuse sid if present, else generate

  // Race-safe: try to insert, retry once on conflict
  let userId: string
  let displayName: string

  try {
    // Create new guest user
    const user = await createGuestUserWithUniqueName()
    userId = user.id
    displayName = user.display_name

    // Insert session row (PK constraint handles races)
    const { error: sessionInsertError } = await supabaseAdmin
      .from('sessions')
      .insert({
        session_id: sid,
        user_id: userId,
        created_at: now,
        last_seen_at: now
      })

    if (sessionInsertError) {
      // If 23505 (unique constraint), another request won - retry by reading
      if (sessionInsertError.code === '23505') {
        debugOAuth('session-insert-conflict', {
          sidSuffix: sid.slice(-6),
          willRetryRead: true
        })

        // Read the winning row
        const { data: winningSession } = await supabaseAdmin
          .from('sessions')
          .select('user_id')
          .eq('session_id', sid)
          .single()

        if (winningSession) {
          userId = winningSession.user_id

          // Get winner's display name
          const { data: winnerUser } = await supabaseAdmin
            .from('users')
            .select('display_name')
            .eq('id', userId)
            .single()

          displayName = winnerUser?.display_name || 'guest'
        } else {
          throw httpError.internal('Session conflict but cannot read winner')
        }
      } else {
        throw httpError.internal('Failed to create session', {
          db: {
            type: 'QUERY',
            operation: 'insert_session',
            table: 'sessions'
          }
        })
      }
    }

    // Upsert presence row
    await supabaseAdmin
      .from('presence')
      .upsert({
        session_id: sid,
        user_id: userId,
        display_name: displayName,
        last_seen_at: now
      }, {
        onConflict: 'session_id'
      })

    debugOAuth('session-created', {
      sidSuffix: sid.slice(-6),
      userId,
      displayName
    })

    return {
      userId,
      sessionId: sid,
      shouldSetCookie: true
    }

  } catch (error) {
    // Re-throw wrapped errors
    throw error
  }
}
