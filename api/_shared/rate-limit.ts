// api/_shared/rate-limit.ts
// Simple in-memory rate limiter for rename endpoint (dev/testing only)

interface RateLimitBucket {
  lastAttempt: number
}

const renameBuckets = new Map<string, RateLimitBucket>()

/**
 * Check if user can perform rename operation
 * Rate limit: 1 rename per 60 seconds per user
 * Only active when ENABLE_RENAME_RL === 'true'
 *
 * @param userId - User ID to check
 * @returns true if allowed, false if rate limited
 */
export function checkRenameRateLimit(userId: string): boolean {
  // Rate limiting is opt-in via env var
  if (process.env.ENABLE_RENAME_RL !== 'true') {
    return true
  }

  const now = Date.now()
  const bucket = renameBuckets.get(userId)

  // No previous attempt or outside window (60 seconds)
  if (!bucket || now - bucket.lastAttempt > 60000) {
    renameBuckets.set(userId, { lastAttempt: now })
    return true
  }

  // Rate limited
  return false
}

/**
 * Clear rate limit buckets (for testing)
 */
export function clearRateLimitBuckets(): void {
  renameBuckets.clear()
}
