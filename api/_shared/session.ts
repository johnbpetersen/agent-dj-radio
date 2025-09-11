// Session ID helper for ephemeral user management
// Extracts and validates session IDs from request headers

import type { VercelRequest } from '@vercel/node'

/**
 * Extract session ID from X-Session-Id header
 * Returns null if missing or invalid UUID format
 */
export function extractSessionId(req: VercelRequest): string | null {
  const sessionId = req.headers['x-session-id']
  
  if (!sessionId || typeof sessionId !== 'string') {
    return null
  }
  
  // Basic UUID v4 format validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  
  if (!uuidRegex.test(sessionId)) {
    return null
  }
  
  return sessionId
}

/**
 * Validate that session ID is present and valid
 * Throws descriptive error if invalid
 */
export function requireSessionId(req: VercelRequest): string {
  const sessionId = extractSessionId(req)
  
  if (!sessionId) {
    const header = req.headers['x-session-id']
    if (!header) {
      throw new Error('Missing X-Session-Id header')
    } else {
      throw new Error('Invalid X-Session-Id format (must be valid UUID)')
    }
  }
  
  return sessionId
}