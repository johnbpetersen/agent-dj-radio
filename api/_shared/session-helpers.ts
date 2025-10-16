// api/_shared/session-helpers.ts
// Session cookie management utilities for Discord OAuth and session handling

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './supabase.js'
import { generateCorrelationId } from '../../src/lib/logger.js'

/**
 * Debug OAuth logging helper
 * Only logs when DEBUG_OAUTH=1 environment variable is set
 * Never logs sensitive data (tokens, secrets, full bodies)
 */
export function debugOAuth(message: string, context?: Record<string, unknown>): void {
  if (process.env.DEBUG_OAUTH === '1') {
    console.log(`[DEBUG_OAUTH] ${message}`, context ? JSON.stringify(context, null, 2) : '')
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
 * - SameSite=Lax: Allows top-level navigation (OAuth flow)
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
 * Set OAuth state cookie for CSRF protection
 * - HttpOnly; SameSite=Lax; Secure (when HTTPS); Path=/
 * - Max-Age: 600 (10 minutes)
 * - No Domain: Host-only
 */
export function setOAuthStateCookie(
  res: VercelResponse,
  state: string,
  req: VercelRequest
): void {
  const maxAgeSeconds = 600 // 10 minutes
  const secure = isHttps(req) ? 'Secure; ' : ''
  const cookieValue = `oauth_state=${state}; HttpOnly; SameSite=Lax; ${secure}Path=/; Max-Age=${maxAgeSeconds}`

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
 * Clear OAuth state cookie after verification
 * Sets Max-Age=0 to delete the cookie
 */
export function clearOAuthStateCookie(
  res: VercelResponse,
  req: VercelRequest
): void {
  const secure = isHttps(req) ? 'Secure; ' : ''
  const cookieValue = `oauth_state=; HttpOnly; SameSite=Lax; ${secure}Path=/; Max-Age=0`

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
 * Load or create ephemeral session, ensuring sid cookie is set
 * Always sets cookie if missing (idempotent)
 *
 * @returns { sid, userId, created } - Session info
 */
export async function ensureSession(
  req: VercelRequest,
  res: VercelResponse
): Promise<{ sid: string; userId: string; created: boolean }> {
  let sid = getSessionId(req)
  let created = false

  // If session exists, verify it in database (use presence table)
  if (sid) {
    const { data: existingSession } = await supabaseAdmin
      .from('presence')
      .select('session_id, user_id')
      .eq('session_id', sid)
      .single()

    if (existingSession) {
      // Session valid - set cookie if not already present
      const cookies = parseCookies(req)
      if (!cookies.sid) {
        setSessionCookie(res, sid, req)
      }

      debugOAuth('Existing session found in ensureSession', {
        sidSuffix: sid.slice(-6),
        userId: existingSession.user_id
      })

      return {
        sid: existingSession.session_id,
        userId: existingSession.user_id,
        created: false
      }
    }

    debugOAuth('Session ID present but not found in presence table', {
      sidSuffix: sid.slice(-6)
    })
  }

  // Create new session
  sid = generateCorrelationId() // UUID v4
  const userId = generateCorrelationId()

  // Generate fun display name for ephemeral user
  const adjectives = ['purple', 'dancing', 'happy', 'cosmic', 'electric', 'quantum', 'stellar', 'lunar']
  const animals = ['raccoon', 'penguin', 'dolphin', 'falcon', 'phoenix', 'dragon', 'octopus', 'panda']
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)]
  const animal = animals[Math.floor(Math.random() * animals.length)]
  const displayName = `${adjective}_${animal}`

  // Create user first
  const { error: userError } = await supabaseAdmin.from('users').insert({
    id: userId,
    display_name: displayName,
    ephemeral: true,
    banned: false
  })

  if (userError) {
    debugOAuth('Failed to create user in ensureSession', { error: userError.message })
    throw new Error(`Failed to create user: ${userError.message}`)
  }

  // Create presence row (not ephemeral_sessions - that table doesn't exist)
  const { error: presenceError } = await supabaseAdmin.from('presence').insert({
    session_id: sid,
    user_id: userId,
    display_name: displayName,
    last_seen_at: new Date().toISOString()
  })

  if (presenceError) {
    debugOAuth('Failed to create presence in ensureSession', { error: presenceError.message })
    throw new Error(`Failed to create presence: ${presenceError.message}`)
  }

  // Always set cookie for new sessions
  setSessionCookie(res, sid, req)
  created = true

  debugOAuth('Created new session in ensureSession', {
    sidSuffix: sid.slice(-6),
    userId,
    displayName
  })

  return { sid, userId, created }
}
