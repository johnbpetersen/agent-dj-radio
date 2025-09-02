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