// api/_shared/payments/facilitator/index.ts
// Public API for x402 facilitator verification
// Orchestrates multi-variant retry strategy for ERC-3009 authorization verification

import { buildCanonical, buildCompat, buildLegacy, type PayloadParams } from './variants.js'
import { postToFacilitator, joinUrl } from './transport.js'
import { parseFacilitatorResponse, FacilitatorError, type FacilitatorSuccess } from './response.js'
import { DEFAULT_RETRY_POLICY } from './policy.js'
import {
  logVerifyAttempt,
  logVerifySuccess,
  logVerifyError,
  logAllVariantsFailed
} from './logger.js'

/**
 * Check if HTTP status should stop variant fallthrough
 * - 401/403: Auth errors, hard stop
 * - 400/404/405/415/422: Client errors that might work with different variant, try next
 * - 5xx: Server errors, try next variant
 */
function shouldStopOnStatus(status: number): boolean {
  // Auth errors: hard stop
  if (status === 401 || status === 403) {
    return true
  }
  // Other errors: try next variant
  return false
}

/**
 * Options for facilitator verification
 */
export interface FacilitatorOptions {
  baseUrl: string // Required - facilitator base URL (e.g., "https://x402.org/facilitator")
}

/**
 * Verify ERC-3009 authorization with facilitator using multi-variant strategy
 *
 * Tries 3 payload variants in sequence:
 * 1. Canonical (chainId as number)
 * 2. Compat (chainId as string, signature at top level)
 * 3. Legacy (old field names)
 *
 * @param params - Verification parameters
 * @param opts - Facilitator options (baseUrl required)
 * @returns Verification result from facilitator
 * @throws Error if all variants fail
 */
export async function facilitatorVerifyAuthorization(
  params: {
    chain: string // e.g., "base", "base-sepolia"
    asset: string // e.g., "usdc"
    chainId: number
    tokenAddress: string
    payTo: string
    amountAtomic: string
    authorization: {
      from: string
      to: string
      value: string | number | bigint
      validAfter: string | number | bigint
      validBefore: string | number | bigint
      nonce: string
      signature: string
    }
  },
  opts: FacilitatorOptions
): Promise<FacilitatorSuccess> {
  // Require explicit baseUrl - no env reading in library
  const baseUrl = opts?.baseUrl
  if (!baseUrl) {
    throw new Error('facilitatorVerifyAuthorization: baseUrl is required in opts')
  }

  // Log resolved base URL for visibility
  console.log('[x402-facilitator] using baseUrl', { baseUrl })

  const url = joinUrl(baseUrl, 'verify')

  // Common params for all variants
  const payloadParams: PayloadParams = {
    chain: params.chain,
    asset: params.asset,
    chainId: params.chainId,
    tokenAddress: params.tokenAddress,
    payTo: params.payTo,
    amountAtomic: params.amountAtomic,
    authorization: params.authorization
  }

  // Define variants to try (in order)
  // Note: Legacy variant removed - it uses wrong field names (token/recipient/amount)
  //       that don't match x402 spec and will always fail with standard facilitators
  const variants = [
    { name: 'canonical', builder: buildCanonical },  // ✅ Matches spec exactly
    { name: 'compat', builder: buildCompat }         // ✅ Matches spec + duplicate signature
  ]

  const attemptedVariants: string[] = []
  let lastError: Error | null = null
  let attemptNum = 0

  // Try each variant
  for (const variant of variants) {
    attemptedVariants.push(variant.name)
    attemptNum++

    try {
      // Build payload for this variant (always returns complete object)
      const payload = variant.builder(payloadParams)

      // Guard: ensure payload has authorization with required fields
      const sigLen = payload.authorization?.signature?.length ?? 0
      const nonceLen = payload.authorization?.nonce?.length ?? 0

      // Log attempt (one-liner with type debug info and exact URL)
      logVerifyAttempt({
        variant: variant.name,
        attempt: attemptNum,
        chainIdType: typeof payload.chainId,
        sigLen,
        nonceLen
      })
      console.log('[x402-facilitator] POST', url)

      // Send request (never throws - returns structured result)
      const startTime = Date.now()
      const httpResult = await postToFacilitator(url, payload)
      const durationMs = httpResult.durationMs

      // Log response details for diagnostics
      console.log('[x402-facilitator] response', {
        status: httpResult.status ?? '(no response)',
        ok: httpResult.ok,
        textLen: httpResult.text?.length ?? 0,
        textPreview: (httpResult.text ?? '').slice(0, 120),
        error: httpResult.error,
        durationMs
      })

      // Parse response (throws FacilitatorError on failure)
      const result = parseFacilitatorResponse(httpResult, url)

      // Success!
      logVerifySuccess({
        variant: variant.name,
        verified: result.verified,
        txHash: result.txHash,
        durationMs
      })

      return result

    } catch (error: any) {
      lastError = error
      const status = error instanceof FacilitatorError ? error.status : undefined

      logVerifyError({
        variant: variant.name,
        error: error.message ?? String(error),
        status,
        durationMs: Date.now() - Date.now() // Approximate
      })

      // Check if we should stop trying more variants
      if (status && shouldStopOnStatus(status)) {
        // Hard stop on auth errors (401/403)
        console.log('[x402-facilitator] hard stop on', status)
        break
      }

      // Continue to next variant for all other errors (404/405/415/422/5xx)
      console.log('[x402-facilitator] trying next variant after', status ?? 'error')
      continue
    }
  }

  // All variants failed - map to PROVIDER_UNAVAILABLE
  const lastStatus = lastError instanceof FacilitatorError ? lastError.status : undefined

  logAllVariantsFailed({
    attemptedVariants,
    finalError: lastError?.message ?? 'Unknown error'
  })

  // Always map to PROVIDER_UNAVAILABLE for user-friendly error
  // (confirm.ts will catch and return 503)
  const err = new Error('Payment verification service temporarily unavailable. Please try again in a moment.')
  ;(err as any).code = 'PROVIDER_UNAVAILABLE'
  ;(err as any).status = lastStatus ?? 503
  ;(err as any).detail = `Tried ${attemptedVariants.join(', ')}: ${lastError?.message ?? 'Unknown error'}`
  throw err
}

/**
 * Alias for facilitatorVerifyAuthorization
 * Maintained for backward compatibility
 */
export async function facilitatorVerify(
  params: {
    chain: string
    asset: string
    chainId: number
    tokenAddress: string
    payTo: string
    amountAtomic: string
    authorization: {
      from: string
      to: string
      value: string | number | bigint
      validAfter: string | number | bigint
      validBefore: string | number | bigint
      nonce: string
      signature: string
    }
  },
  opts: FacilitatorOptions
): Promise<FacilitatorSuccess> {
  return facilitatorVerifyAuthorization(params, opts)
}

// Re-export types for consumers
export type { FacilitatorSuccess } from './response.js'
export type { PayloadParams } from './variants.js'
