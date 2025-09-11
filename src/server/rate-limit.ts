// Per-user submit cooldown tracking

import type { RateLimitInfo } from '../types'

// In-memory rate limit storage (sufficient for MVP)
// In production, this could be Redis or database-backed
const rateLimits = new Map<string, RateLimitInfo>()

// Cooldown period in seconds
const SUBMIT_COOLDOWN_SECONDS = 60

export interface CheckCooldownParams {
  userId: string
}

export interface CheckCooldownResult {
  allowed: boolean
  remainingSeconds?: number
  lastSubmitAt?: number
}

/**
 * Check if user can submit a new track
 */
export function checkSubmitCooldown({ userId }: CheckCooldownParams): CheckCooldownResult {
  if (!userId) {
    throw new Error('User ID is required')
  }

  const now = Date.now()
  const userLimit = rateLimits.get(userId)
  
  if (!userLimit) {
    return { allowed: true }
  }

  const elapsedSeconds = Math.floor((now - userLimit.last_submit_at) / 1000)
  const remainingSeconds = SUBMIT_COOLDOWN_SECONDS - elapsedSeconds
  
  if (remainingSeconds <= 0) {
    return { 
      allowed: true,
      lastSubmitAt: userLimit.last_submit_at 
    }
  }

  return {
    allowed: false,
    remainingSeconds,
    lastSubmitAt: userLimit.last_submit_at
  }
}

export interface RecordSubmitParams {
  userId: string
}

/**
 * Record a successful submit to start cooldown
 */
export function recordSubmit({ userId }: RecordSubmitParams): void {
  if (!userId) {
    throw new Error('User ID is required')
  }

  const now = Date.now()
  
  rateLimits.set(userId, {
    user_id: userId,
    last_submit_at: now,
    cooldown_seconds: SUBMIT_COOLDOWN_SECONDS
  })
}

/**
 * Clear rate limit for a user (for testing)
 */
export function clearUserCooldown({ userId }: CheckCooldownParams): void {
  rateLimits.delete(userId)
}

/**
 * Get current rate limit info for a user
 */
export function getRateLimitInfo({ userId }: CheckCooldownParams): RateLimitInfo | null {
  return rateLimits.get(userId) || null
}

/**
 * Clean up expired rate limits (call periodically)
 */
export function cleanupExpiredLimits(): number {
  const now = Date.now()
  let cleaned = 0
  
  for (const [userId, limit] of rateLimits.entries()) {
    const elapsedSeconds = Math.floor((now - limit.last_submit_at) / 1000)
    
    if (elapsedSeconds >= SUBMIT_COOLDOWN_SECONDS * 2) { // Keep for 2x cooldown period
      rateLimits.delete(userId)
      cleaned++
    }
  }
  
  return cleaned
}

// Session-based rate limiting for ephemeral users
// In-memory storage with TTL cleanup

interface SessionRateLimitEntry {
  sessionId: string
  endpoint: string
  lastActionAt: number
  count: number
  windowStart: number
}

const sessionRateLimits = new Map<string, SessionRateLimitEntry>()

export interface SessionRateLimitOptions {
  windowMs: number
  maxRequests: number
}

export interface SessionRateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
  throttled?: boolean
}

/**
 * Check session-based rate limiting for ephemeral user endpoints
 */
export function checkSessionRateLimit(
  sessionId: string, 
  endpoint: string, 
  options: SessionRateLimitOptions
): SessionRateLimitResult {
  if (!sessionId) {
    throw new Error('Session ID is required')
  }

  const now = Date.now()
  const key = `${sessionId}:${endpoint}`
  
  // Clean up expired entries first
  cleanupExpiredSessionLimits(now)
  
  let entry = sessionRateLimits.get(key)
  
  // Create new entry if not exists or window expired
  if (!entry || (now - entry.windowStart) >= options.windowMs) {
    entry = {
      sessionId,
      endpoint,
      lastActionAt: now,
      count: 1,
      windowStart: now
    }
    sessionRateLimits.set(key, entry)
    
    return {
      allowed: true,
      remaining: options.maxRequests - 1,
      resetTime: now + options.windowMs
    }
  }
  
  // Update last action time and increment count
  entry.lastActionAt = now
  entry.count++
  
  const allowed = entry.count <= options.maxRequests
  const remaining = Math.max(0, options.maxRequests - entry.count)
  const resetTime = entry.windowStart + options.windowMs
  
  return {
    allowed,
    remaining,
    resetTime
  }
}

/**
 * Special handling for presence ping throttling
 * If last ping was < 10 seconds ago, return throttled without updating DB
 */
export function checkPresencePingThrottle(sessionId: string): SessionRateLimitResult {
  if (!sessionId) {
    throw new Error('Session ID is required')
  }

  const now = Date.now()
  const key = `${sessionId}:presence:ping`
  const THROTTLE_MS = 10 * 1000 // 10 seconds
  
  const entry = sessionRateLimits.get(key)
  
  if (entry && (now - entry.lastActionAt) < THROTTLE_MS) {
    // Throttled - don't update database
    return {
      allowed: true,
      remaining: 0,
      resetTime: entry.lastActionAt + THROTTLE_MS,
      throttled: true
    }
  }
  
  // Update or create entry
  sessionRateLimits.set(key, {
    sessionId,
    endpoint: 'presence:ping',
    lastActionAt: now,
    count: 1,
    windowStart: now
  })
  
  return {
    allowed: true,
    remaining: 1,
    resetTime: now + THROTTLE_MS,
    throttled: false
  }
}

/**
 * Clean up expired session rate limit entries
 */
function cleanupExpiredSessionLimits(now: number): void {
  const MAX_AGE_MS = 60 * 60 * 1000 // 1 hour
  
  for (const [key, entry] of sessionRateLimits.entries()) {
    if ((now - entry.lastActionAt) > MAX_AGE_MS) {
      sessionRateLimits.delete(key)
    }
  }
}

/**
 * Clear all session rate limits for a session (for testing/cleanup)
 */
export function clearSessionRateLimits(sessionId: string): void {
  for (const [key] of sessionRateLimits.entries()) {
    if (key.startsWith(`${sessionId}:`)) {
      sessionRateLimits.delete(key)
    }
  }
}

/**
 * Get session rate limit stats (for debugging)
 */
export function getSessionRateLimitStats(): { totalSessions: number, totalEntries: number } {
  const sessions = new Set<string>()
  
  for (const [key] of sessionRateLimits.entries()) {
    const sessionId = key.split(':')[0]
    sessions.add(sessionId)
  }
  
  return {
    totalSessions: sessions.size,
    totalEntries: sessionRateLimits.size
  }
}