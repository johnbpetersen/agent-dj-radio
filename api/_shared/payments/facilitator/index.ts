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
  const variants = [
    { name: 'canonical', builder: buildCanonical },
    { name: 'compat', builder: buildCompat },
    { name: 'legacy', builder: buildLegacy }
  ]

  const attemptedVariants: string[] = []
  let lastError: Error | null = null
  let attemptNum = 0

  // Try each variant
  for (const variant of variants) {
    attemptedVariants.push(variant.name)
    attemptNum++

    try {
      // Build payload for this variant
      const payload = variant.builder(payloadParams)

      // Log attempt (one-liner with type debug info and exact URL)
      logVerifyAttempt({
        variant: variant.name,
        attempt: attemptNum,
        chainIdType: typeof payload.chainId,
        sigLen: payload.authorization.signature.length,
        nonceLen: payload.authorization.nonce.length
      })
      console.log('[x402-facilitator] POST', url)

      // Send request
      const startTime = Date.now()
      const response = await postToFacilitator(url, payload)
      const durationMs = Date.now() - startTime

      // Parse response
      const result = await parseFacilitatorResponse(response, url)

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
      const durationMs = Date.now() - Date.now() // Best effort

      logVerifyError({
        variant: variant.name,
        error: error.message,
        status,
        durationMs
      })

      // Check if we should stop trying more variants
      if (status && shouldStopOnStatus(status)) {
        // Hard stop on auth errors (401/403)
        break
      }

      // Continue to next variant for all other errors
      continue
    }
  }

  // All variants failed - map to PROVIDER_UNAVAILABLE if all were 5xx
  const lastStatus = lastError instanceof FacilitatorError ? lastError.status : undefined

  logAllVariantsFailed({
    attemptedVariants,
    finalError: lastError?.message || 'Unknown error'
  })

  // Map 5xx errors to PROVIDER_UNAVAILABLE
  if (lastStatus && lastStatus >= 500) {
    const err = new Error('Payment verification service temporarily unavailable. Please try again in a moment.')
    ;(err as any).code = 'PROVIDER_UNAVAILABLE'
    ;(err as any).status = 503
    throw err
  }

  // Other errors: return as-is with facilitator error details
  throw new Error(
    `Facilitator verification failed (tried ${attemptedVariants.join(', ')}): ${lastError?.message || 'Unknown error'}`
  )
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
