// api/_shared/session-helpers.ts
// Session cookie management utilities for Discord OAuth and session handling

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './supabase.js'
import { generateCorrelationId } from '../../src/lib/logger.js'

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
 */
export function isHttps(req: VercelRequest): boolean {
  const proto = req.headers['x-forwarded-proto']
  if (proto) return proto === 'https'

  // Fallback: assume production is HTTPS
  return process.env.NODE_ENV === 'production'
}

/**
 * Set session cookie with secure attributes
 * - httpOnly: Prevents JavaScript access
 * - SameSite=Lax: Allows top-level navigation (OAuth flow)
 * - Secure: Only sent over HTTPS in production
 * - Path=/: Available to all routes
 * - No Domain: Host-only (most secure)
 */
export function setSessionCookie(
  res: VercelResponse,
  sid: string,
  options: { maxAgeDays?: number } = {}
): void {
  const maxAgeDays = options.maxAgeDays ?? 30
  const maxAgeSeconds = maxAgeDays * 24 * 60 * 60

  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : ''
  const cookieValue = `sid=${sid}; HttpOnly; SameSite=Lax; ${secure}Path=/; Max-Age=${maxAgeSeconds}`

  res.setHeader('Set-Cookie', cookieValue)
}

/**
 * Set OAuth state cookie for CSRF protection
 * Short TTL (10 minutes) for security
 */
export function setOAuthStateCookie(
  res: VercelResponse,
  state: string,
  req: VercelRequest
): void {
  const maxAgeSeconds = 10 * 60 // 10 minutes
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

  // If session exists, verify it in database
  if (sid) {
    const { data: existingSession } = await supabaseAdmin
      .from('ephemeral_sessions')
      .select('id, user_id')
      .eq('id', sid)
      .single()

    if (existingSession) {
      // Session valid - set cookie if not already present
      const cookies = parseCookies(req)
      if (!cookies.sid) {
        setSessionCookie(res, sid)
      }

      return {
        sid: existingSession.id,
        userId: existingSession.user_id,
        created: false
      }
    }
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

  // Create user and session
  await supabaseAdmin.from('users').insert({
    id: userId,
    display_name: displayName,
    ephemeral: true,
    banned: false
  })

  await supabaseAdmin.from('ephemeral_sessions').insert({
    id: sid,
    user_id: userId,
    last_seen_at: new Date().toISOString()
  })

  // Always set cookie for new sessions
  setSessionCookie(res, sid)
  created = true

  return { sid, userId, created }
}
