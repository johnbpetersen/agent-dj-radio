// api/_shared/payments/facilitator/index.ts
// Public API for x402 facilitator verification
// Orchestrates multi-variant retry strategy for ERC-3009 authorization verification
// Supports multiple facilitator dialects (flat canonical, PayAI v1)
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

import { buildCanonical, buildCompat, type PayloadParams } from './variants.js'
import { postToFacilitator, joinUrl } from './transport.js'
import { parseFacilitatorResponse, FacilitatorError, type FacilitatorSuccess } from './response.js'
import { buildPayAiVerifyBody, parsePayAiVerifyResponse, type PayAiVerifyParams } from './dialects/payaiv1.js'
import { serverEnv } from '../../../../src/config/env.server.js'
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

  // Detect facilitator dialect from env (default: 'flat' for backward compatibility)
  // 'flat' = original canonical/compat variants
  // 'payai' = PayAI v1 nested structure (Daydreams)
  const dialect = serverEnv.X402_FACILITATOR_DIALECT || 'flat'

  // Log resolved base URL and dialect for visibility
  console.log('[x402-facilitator] using baseUrl', { baseUrl, dialect })

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

  // PayAI dialect: use dedicated builder (no multi-variant retry)
  if (dialect === 'payai') {
    console.log('[x402-facilitator] using PayAI v1 dialect')

    // Normalize authorization to ensure all fields are strings
    const normalizedAuth = {
      from: String(params.authorization.from).toLowerCase(),
      to: String(params.authorization.to).toLowerCase(),
      value: String(params.authorization.value),
      validAfter: String(params.authorization.validAfter),
      validBefore: String(params.authorization.validBefore),
      nonce: String(params.authorization.nonce).toLowerCase(),
      signature: String(params.authorization.signature).toLowerCase()
    }

    // Map chain to network identifier for PayAI
    const network = params.chain === 'base' ? 'base' : params.chain

    const payAiParams: PayAiVerifyParams = {
      network,
      payTo: params.payTo.toLowerCase(),
      tokenAddress: params.tokenAddress.toLowerCase(),
      amountAtomic: String(params.amountAtomic),
      authorization: normalizedAuth
    }

    const payload = buildPayAiVerifyBody(payAiParams)

    console.log('[x402-facilitator] PayAI payload preview:', {
      x402VersionTopLevel: (payload as any).x402Version,
      x402VersionInPaymentPayload: payload.paymentPayload.x402Version,
      scheme: payload.paymentPayload.scheme,
      network: payload.paymentPayload.network,
      maxAmountRequired: payload.paymentRequirements.maxAmountRequired,
      payTo: payload.paymentRequirements.payTo.substring(0, 10) + '...',
      asset: payload.paymentRequirements.asset.substring(0, 10) + '...'
    })
    console.log('[x402-facilitator] FULL PayAI body →\n' + JSON.stringify(payload, null, 2))
    console.log('[x402-facilitator] POST', url)

    const httpResult = await postToFacilitator(url, payload)
    const durationMs = httpResult.durationMs

    console.log('[x402-facilitator] response', {
      status: httpResult.status ?? '(no response)',
      ok: httpResult.ok,
      textLen: httpResult.text?.length ?? 0,
      textPreview: (httpResult.text ?? '').slice(0, 120),
      error: httpResult.error,
      durationMs
    })

    // Parse PayAI response
    if (!httpResult.ok || !httpResult.status) {
      const err = new Error('Payment verification service temporarily unavailable. Please try again in a moment.')
      ;(err as any).code = 'PROVIDER_UNAVAILABLE'
      ;(err as any).status = httpResult.status ?? 503
      ;(err as any).detail = httpResult.error || httpResult.text
      throw err
    }

    let json: any = null
    try {
      json = httpResult.text ? JSON.parse(httpResult.text) : null
    } catch (parseErr) {
      const err = new Error('Invalid JSON response from payment service')
      ;(err as any).code = 'PROVIDER_ERROR'
      ;(err as any).status = httpResult.status
      ;(err as any).detail = httpResult.text
      throw err
    }

    const result = parsePayAiVerifyResponse(json)

    if (!result.ok) {
      const err = new Error(result.message)
      ;(err as any).code = result.code
      ;(err as any).status = httpResult.status
      ;(err as any).detail = result.detail
      throw err
    }

    const payer =
    (json?.payer ?? normalizedAuth.from)?.toLowerCase()

    logVerifySuccess({
      variant: 'payai-v1',
      verified: true,
      txHash: undefined,
      durationMs
    })

    return {
      ok: true,
      verified: true,
      amountPaidAtomic: String(params.amountAtomic),
      tokenFrom: payer,
      txHash: normalizedAuth.nonce,
      providerRaw: json
    }
  }

  // Flat dialect (original): Multi-variant retry strategy
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

      // Debug: Log exact payload being sent (first variant only, to avoid spam)
      if (attemptNum === 1) {
        console.log('[x402-facilitator] payload preview:', {
          scheme: payload.scheme,
          chainId: payload.chainId,
          chainIdType: typeof payload.chainId,
          tokenAddress: payload.tokenAddress?.substring(0, 10) + '...',
          payTo: payload.payTo?.substring(0, 10) + '...',
          amountAtomic: payload.amountAtomic,
          hasAuth: !!payload.authorization,
          authSigLen: payload.authorization?.signature?.length,
          authNonceLen: payload.authorization?.nonce?.length,
          topLevelSigLen: (payload as any).signature?.length || 0
        })
      }

      // Send request (never throws - returns structured result)
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
