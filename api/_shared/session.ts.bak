// Session ID helper for ephemeral user management
// Extracts and validates session IDs from request headers, cookies, or OAuth state

import type { VercelRequest } from '@vercel/node'

// UUID v4 format validation
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Validate UUID v4 format
 */
function isValidUuidV4(value: string): boolean {
  return UUID_V4_REGEX.test(value)
}

/**
 * Parse cookie header and extract a specific cookie value
 */
function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Try to extract session ID from OAuth state parameter (base64url encoded JSON)
 * Used as fallback for Discord OAuth callback
 */
function extractSidFromState(req: VercelRequest): string | null {
  try {
    const state = req.query?.state
    if (!state || typeof state !== 'string') return null

    // Decode base64url to JSON
    const base64 = state
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const json = Buffer.from(base64 + padding, 'base64').toString('utf-8')
    const payload = JSON.parse(json)

    // Extract and validate sid
    const sid = payload?.sid
    if (typeof sid === 'string' && isValidUuidV4(sid)) {
      return sid
    }
  } catch {
    // Parsing failed - not a valid state payload
  }
  return null
}

/**
 * Extract session ID from X-Session-Id header
 * Returns null if missing or invalid UUID format
 */
export function extractSessionId(req: VercelRequest): string | null {
  const sessionId = req.headers['x-session-id']

  if (!sessionId || typeof sessionId !== 'string') {
    return null
  }

  if (!isValidUuidV4(sessionId)) {
    return null
  }

  return sessionId
}

/**
 * Validate that session ID is present and valid
 * Tries multiple sources in order: header → cookie → state parameter
 * Throws descriptive error if invalid or missing from all sources
 */
export function requireSessionId(req: VercelRequest): string {
  // 1. Try header (standard case)
  const fromHeader = extractSessionId(req)
  if (fromHeader) {
    return fromHeader
  }

  // 2. Try cookie (OAuth redirect case)
  const fromCookie = parseCookie(req.headers.cookie, 'x_session_id')
  if (fromCookie && isValidUuidV4(fromCookie)) {
    return fromCookie
  }

  // 3. Try state parameter (belt-and-suspenders for OAuth callback)
  const fromState = extractSidFromState(req)
  if (fromState) {
    return fromState
  }

  // All sources failed
  throw new Error('Missing X-Session-Id header')
}

/**
 * Require authenticated session and return userId + sessionId
 * Uses presence table to map session_id → user_id
 * Throws AppError.UNAUTHORIZED if session not found or invalid
 */
export async function requireSession(req: VercelRequest): Promise<{ userId: string; sessionId: string }> {
  const { supabaseAdmin } = await import('./supabase.js')
  const { httpError } = await import('./errors.js')

  // Extract session ID from cookie/header
  let sessionId: string
  try {
    sessionId = requireSessionId(req)
  } catch {
    throw httpError.unauthorized('You are not signed in', 'Please sign in and try again')
  }

  // Query presence to get userId
  const { data: presence, error } = await supabaseAdmin
    .from('presence')
    .select('user_id')
    .eq('session_id', sessionId)
    .single()

  if (error || !presence) {
    throw httpError.unauthorized('Session expired', 'Please refresh the page and try again')
  }

  return {
    userId: presence.user_id,
    sessionId
  }
}