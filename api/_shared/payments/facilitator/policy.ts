// api/_shared/payments/facilitator/policy.ts
// Retry policy and jitter for facilitator API calls
// Handles exponential backoff and circuit breaking

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

/**
 * Default retry policy (conservative)
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2
}

/**
 * Calculate delay for retry attempt with exponential backoff and jitter
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param policy - Retry policy configuration
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(attempt: number, policy: RetryPolicy): number {
  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  const exponentialDelay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt)

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, policy.maxDelayMs)

  // Add jitter (±25% of delay)
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1)
  const finalDelay = Math.max(0, cappedDelay + jitter)

  return Math.floor(finalDelay)
}

/**
 * Sleep for specified duration
 *
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute operation with retry policy
 *
 * @param operation - Async operation to execute
 * @param shouldRetry - Function to determine if error should be retried
 * @param policy - Retry policy configuration
 * @returns Result of successful operation
 * @throws Last error if all retries exhausted
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: Error) => boolean,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      lastError = error

      // Check if we should retry
      if (!shouldRetry(error)) {
        throw error
      }

      // Check if we have more attempts
      if (attempt < policy.maxAttempts - 1) {
        const delay = calculateRetryDelay(attempt, policy)
        await sleep(delay)
      }
    }
  }

  // All retries exhausted
  throw lastError || new Error('All retries exhausted')
}
