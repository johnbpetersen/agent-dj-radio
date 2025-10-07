// api/_shared/payments/x402-cdp.ts
// Coinbase CDP payment verification adapter for x402 protocol

import { serverEnv } from '../../../src/config/env.server.js'
import { logger } from '../../../src/lib/logger.js'

// Error codes for payment verification
export type VerificationErrorCode =
  | 'WRONG_AMOUNT'
  | 'WRONG_ASSET'
  | 'WRONG_CHAIN'
  | 'NO_MATCH'
  | 'EXPIRED'
  | 'PROVIDER_ERROR'

export interface VerifyPaymentInput {
  txHash: string
  payTo: string
  amountAtomic: number // Expected minimum amount in atomic units (e.g., USDC with 6 decimals)
  asset: string
  chain: string
  challengeId: string
}

export interface VerifyPaymentSuccess {
  ok: true
  amountPaidAtomic: number
}

export interface VerifyPaymentFailure {
  ok: false
  code: VerificationErrorCode
  detail?: string
}

export type VerifyPaymentResult = VerifyPaymentSuccess | VerifyPaymentFailure

// Jittered exponential backoff delays (milliseconds)
const RETRY_DELAYS = [300, 800, 1500]

/**
 * Adds random jitter to a delay value to prevent thundering herd
 */
function jitter(baseMs: number): number {
  return baseMs + Math.random() * 200 - 100 // ±100ms jitter
}

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * CDP API response types (based on expected contract)
 */
interface CDPVerifyResponse {
  verified: boolean
  amountPaid?: number // Atomic units
  asset?: string
  chain?: string
  error?: {
    code: string
    message: string
  }
}

/**
 * Map CDP error responses to our standardized error codes
 */
function mapCDPError(cdpResponse: CDPVerifyResponse, input: VerifyPaymentInput): VerifyPaymentFailure {
  const errorMsg = cdpResponse.error?.message || 'Verification failed'
  const errorCode = cdpResponse.error?.code || 'UNKNOWN'

  // Check for specific validation failures
  if (cdpResponse.amountPaid !== undefined && cdpResponse.amountPaid < input.amountAtomic) {
    const diff = input.amountAtomic - cdpResponse.amountPaid
    return {
      ok: false,
      code: 'WRONG_AMOUNT',
      detail: `Insufficient payment: expected ${input.amountAtomic}, got ${cdpResponse.amountPaid} (short by ${diff})`
    }
  }

  if (cdpResponse.asset && cdpResponse.asset !== input.asset) {
    return {
      ok: false,
      code: 'WRONG_ASSET',
      detail: `Expected ${input.asset}, got ${cdpResponse.asset}`
    }
  }

  if (cdpResponse.chain && cdpResponse.chain !== input.chain) {
    return {
      ok: false,
      code: 'WRONG_CHAIN',
      detail: `Expected ${input.chain}, got ${cdpResponse.chain}`
    }
  }

  // Map CDP error codes to our codes
  if (errorCode.includes('NOT_FOUND') || errorCode.includes('NO_TRANSACTION')) {
    return { ok: false, code: 'NO_MATCH', detail: errorMsg }
  }

  if (errorCode.includes('EXPIRED') || errorCode.includes('TIMEOUT')) {
    return { ok: false, code: 'EXPIRED', detail: errorMsg }
  }

  if (errorCode.includes('INSUFFICIENT') || errorCode.includes('AMOUNT')) {
    return { ok: false, code: 'WRONG_AMOUNT', detail: errorMsg }
  }

  if (errorCode.includes('ASSET') || errorCode.includes('TOKEN')) {
    return { ok: false, code: 'WRONG_ASSET', detail: errorMsg }
  }

  if (errorCode.includes('CHAIN') || errorCode.includes('NETWORK')) {
    return { ok: false, code: 'WRONG_CHAIN', detail: errorMsg }
  }

  // Default to PROVIDER_ERROR for unknown issues
  return { ok: false, code: 'PROVIDER_ERROR', detail: errorMsg }
}

/**
 * Verify a payment transaction via Coinbase CDP
 *
 * This function validates that a blockchain transaction matches the expected
 * payment parameters. It implements retry logic with jittered exponential backoff
 * for transient failures (429, 5xx).
 *
 * @param input - Payment verification parameters
 * @returns Verification result with amountPaidAtomic on success, or error code on failure
 */
export async function verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
  const { txHash, payTo, amountAtomic, asset, chain, challengeId } = input

  // Validate configuration
  if (!serverEnv.X402_PROVIDER_URL) {
    logger.error('X402_PROVIDER_URL not configured')
    return { ok: false, code: 'PROVIDER_ERROR', detail: 'Payment provider not configured' }
  }

  if (!serverEnv.X402_API_KEY) {
    logger.error('X402_API_KEY not configured')
    return { ok: false, code: 'PROVIDER_ERROR', detail: 'Payment provider authentication not configured' }
  }

  logger.info('CDP verification started', {
    challengeId,
    txHash,
    chain,
    asset,
    amountAtomic,
    payTo: payTo.substring(0, 10) + '...' // Truncate for logging
  })

  let lastError: Error | null = null
  let attempt = 0

  // Retry loop with exponential backoff
  for (const delay of RETRY_DELAYS) {
    attempt++

    try {
      logger.debug('CDP verification attempt', { challengeId, attempt, maxAttempts: RETRY_DELAYS.length })

      const response = await fetch(`${serverEnv.X402_PROVIDER_URL}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': serverEnv.X402_API_KEY,
          'User-Agent': 'Agent-DJ-Radio/1.0'
        },
        body: JSON.stringify({
          txHash,
          payTo,
          amountAtomic,
          asset,
          chain,
          challengeId
        }),
        signal: AbortSignal.timeout(10000) // 10s timeout
      })

      // Handle retryable errors (429, 5xx)
      if (response.status === 429 || response.status >= 500) {
        const errorText = await response.text().catch(() => 'Unable to read error')
        lastError = new Error(`CDP returned ${response.status}: ${errorText}`)

        logger.warn('CDP verification retryable error', {
          challengeId,
          attempt,
          status: response.status,
          error: errorText
        })

        // Wait before retry (unless this was the last attempt)
        if (attempt < RETRY_DELAYS.length) {
          await sleep(jitter(delay))
          continue
        }

        // Last attempt failed
        return {
          ok: false,
          code: 'PROVIDER_ERROR',
          detail: `Provider unavailable after ${RETRY_DELAYS.length} attempts: ${lastError.message}`
        }
      }

      // Handle non-retryable errors (4xx except 429)
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error')
        logger.warn('CDP verification failed', {
          challengeId,
          status: response.status,
          error: errorText
        })

        // Try to parse as JSON for structured error
        try {
          const cdpError = JSON.parse(errorText) as CDPVerifyResponse
          return mapCDPError(cdpError, input)
        } catch {
          // Couldn't parse, return generic error
          return {
            ok: false,
            code: 'PROVIDER_ERROR',
            detail: `Provider returned ${response.status}: ${errorText}`
          }
        }
      }

      // Success path: parse response (treat as untrusted, validate shape)
      let cdpResponse: CDPVerifyResponse
      try {
        const rawResponse = await response.json()

        // Validate response has expected shape (avoid .map on undefined, etc.)
        if (typeof rawResponse !== 'object' || rawResponse === null) {
          logger.error('CDP verification: malformed response (not an object)', {
            challengeId,
            txHash,
            responseType: typeof rawResponse
          })
          return {
            ok: false,
            code: 'PROVIDER_ERROR',
            detail: 'Malformed provider response (not an object)'
          }
        }

        cdpResponse = rawResponse as CDPVerifyResponse

        // Ensure verified field exists and is boolean
        if (typeof cdpResponse.verified !== 'boolean') {
          logger.error('CDP verification: malformed response (missing verified field)', {
            challengeId,
            txHash,
            response: JSON.stringify(rawResponse)
          })
          return {
            ok: false,
            code: 'PROVIDER_ERROR',
            detail: 'Malformed provider response (missing verified field)'
          }
        }
      } catch (parseError) {
        logger.error('CDP verification: failed to parse JSON response', {
          challengeId,
          txHash,
          error: parseError instanceof Error ? parseError.message : String(parseError)
        })
        return {
          ok: false,
          code: 'PROVIDER_ERROR',
          detail: 'Failed to parse provider response'
        }
      }

      if (!cdpResponse.verified) {
        logger.warn('CDP verification rejected', {
          challengeId,
          txHash,
          error: cdpResponse.error
        })
        return mapCDPError(cdpResponse, input)
      }

      // Validation: Check amount paid meets minimum requirement
      // Optional-chain to handle missing/undefined amountPaid
      const amountPaid = cdpResponse.amountPaid ?? 0
      if (typeof amountPaid !== 'number' || amountPaid < amountAtomic) {
        const diff = amountAtomic - amountPaid
        logger.warn('CDP verification: insufficient amount', {
          challengeId,
          txHash,
          expected: amountAtomic,
          actual: amountPaid,
          shortfall: diff
        })
        return {
          ok: false,
          code: 'WRONG_AMOUNT',
          detail: `Insufficient payment: expected ${amountAtomic}, got ${amountPaid} (short by ${diff})`
        }
      }

      // Validation: Check asset matches (optional-chain)
      const paidAsset = cdpResponse.asset || asset
      if (paidAsset !== asset) {
        logger.warn('CDP verification: wrong asset', {
          challengeId,
          txHash,
          expected: asset,
          actual: paidAsset
        })
        return {
          ok: false,
          code: 'WRONG_ASSET',
          detail: `Expected ${asset}, got ${paidAsset}`
        }
      }

      // Validation: Check chain matches (optional-chain)
      const paidChain = cdpResponse.chain || chain
      if (paidChain !== chain) {
        logger.warn('CDP verification: wrong chain', {
          challengeId,
          txHash,
          expected: chain,
          actual: paidChain
        })
        return {
          ok: false,
          code: 'WRONG_CHAIN',
          detail: `Expected ${chain}, got ${paidChain}`
        }
      }

      // All validations passed!
      logger.info('CDP verification successful', {
        challengeId,
        txHash,
        amountPaidAtomic: amountPaid,
        asset: paidAsset,
        chain: paidChain,
        attempt
      })

      return {
        ok: true,
        amountPaidAtomic: amountPaid
      }

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      logger.warn('CDP verification attempt failed', {
        challengeId,
        attempt,
        error: lastError.message
      })

      // Wait before retry (unless this was the last attempt)
      if (attempt < RETRY_DELAYS.length) {
        await sleep(jitter(delay))
        continue
      }
    }
  }

  // All retries exhausted
  logger.error('CDP verification failed after all retries', {
    challengeId,
    txHash,
    attempts: RETRY_DELAYS.length,
    lastError: lastError?.message
  })

  return {
    ok: false,
    code: 'PROVIDER_ERROR',
    detail: lastError?.message || 'Payment verification failed after multiple attempts'
  }
}
