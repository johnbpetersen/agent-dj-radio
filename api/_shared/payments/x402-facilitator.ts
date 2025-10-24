// api/_shared/payments/x402-facilitator.ts
// x402 facilitator payment verification using REST API (for testnet/Base Sepolia)
// Hardened with timeouts, retries, strict validation, and observability

import { serverEnv } from '../../../src/config/env.server.js'
import { maskTxHash, maskAddress, normalizeAddress, normalizeIdentifier } from '../../../src/lib/crypto-utils.js'
import { incrementCounter, recordLatency } from '../../../src/lib/metrics.js'

/**
 * Safely join facilitator base URL with path segment
 * Handles trailing slashes and ensures correct URL construction
 *
 * @example
 * joinFacilitator('https://x402.org/facilitator', 'verify')
 * // => 'https://x402.org/facilitator/verify'
 *
 * joinFacilitator('https://x402.org/facilitator/', 'verify')
 * // => 'https://x402.org/facilitator/verify'
 */
function joinFacilitator(base: string, path: string): string {
  const baseUrl = new URL(base)

  // Ensure base pathname ends with slash (treat as directory)
  if (!baseUrl.pathname.endsWith('/')) {
    baseUrl.pathname += '/'
  }

  // Remove leading slash from path (use relative resolution)
  const relativePath = path.replace(/^\//, '')

  // Resolve relative path against base
  const result = new URL(relativePath, baseUrl)

  return result.toString()
}

/**
 * Convert numeric value to decimal string (strip leading zeros)
 * Facilitators expect uint256 as decimal strings, not JS numbers
 *
 * @param x - Value to convert (bigint, number, or string)
 * @returns Normalized decimal string
 */
function asDecString(x: bigint | number | string): string {
  if (typeof x === 'bigint') {
    return x.toString()
  }

  if (typeof x === 'number') {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite numeric value: ${x}`)
    }
    return Math.trunc(x).toString()
  }

  if (typeof x === 'string') {
    // Strip leading zeros but preserve "0"
    return x.replace(/^0+(\d)/, '$1') || '0'
  }

  throw new Error(`Invalid numeric type: ${typeof x}`)
}

/**
 * Normalize ERC-3009 authorization for wire format
 * All hex values lowercase, all numerics as decimal strings
 *
 * @param auth - Raw authorization object
 * @returns Wire-safe authorization object
 */
function normalizeAuthForWire(auth: {
  from: string
  to: string
  value: string | number | bigint
  validAfter: string | number | bigint
  validBefore: string | number | bigint
  nonce: string
  signature: string
}): {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
  signature: string
} {
  return {
    from: auth.from.toLowerCase(),
    to: auth.to.toLowerCase(),
    value: asDecString(auth.value),
    validAfter: asDecString(auth.validAfter),
    validBefore: asDecString(auth.validBefore),
    nonce: auth.nonce.toLowerCase(),
    signature: auth.signature.toLowerCase()
  }
}

export type VerifyOk = {
  ok: true
  amountPaidAtomic: string | number
  tokenFrom?: string  // ERC-20 Transfer 'from' address (authoritative payer for binding)
  txSender?: string   // Transaction sender address (may be relayer/router)
  txFrom?: string     // Deprecated: use tokenFrom ?? txSender instead
  providerRaw?: any
}

export type VerifyErr = {
  ok: false
  code: 'WRONG_CHAIN'|'WRONG_ASSET'|'WRONG_AMOUNT'|'NO_MATCH'|'EXPIRED'|'PROVIDER_ERROR'
  message: string
  detail?: string
}

export type VerifyResult = VerifyOk | VerifyErr

// Retry configuration
const TIMEOUT_MS = 10000 // 10s per attempt
const RETRY_DELAYS_MS = [300, 800] // 2 retries with jitter base delays
const MAX_ATTEMPTS = 1 + RETRY_DELAYS_MS.length // initial + retries

/**
 * Add jitter to retry delay (±25% randomization)
 */
function addJitter(baseMs: number): number {
  const jitter = baseMs * 0.25
  return Math.floor(baseMs + (Math.random() * 2 - 1) * jitter)
}

/**
 * Check if error is retryable (5xx or network error)
 */
function isRetryable(status?: number, error?: any): boolean {
  // Network errors (fetch failures)
  if (error && (
    error.message?.includes('fetch failed') ||
    error.message?.includes('ECONNREFUSED') ||
    error.message?.includes('ENOTFOUND') ||
    error.message?.includes('ETIMEDOUT')
  )) {
    return true
  }

  // 5xx errors
  if (status && status >= 500) {
    return true
  }

  return false
}

/**
 * Validate facilitator response fields against expected values
 */
function validateResponse(
  json: any,
  expected: { chain: string; asset: string; payTo: string; amountAtomic: number }
): VerifyErr | null {
  // Field name variations: to/payTo, asset/symbol, chain/network, amount/amountAtomic
  const responseTo = json.to || json.payTo
  const responseAsset = json.asset || json.symbol
  const responseChain = json.chain || json.network
  const responseAmount = json.amountAtomic || json.amount

  // Check required fields present
  if (!responseTo || !responseAsset || !responseChain || !responseAmount) {
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: 'Facilitator response missing required fields',
      detail: `Missing: to=${!responseTo}, asset=${!responseAsset}, chain=${!responseChain}, amount=${!responseAmount}`
    }
  }

  // Validate 'to' address matches
  if (normalizeAddress(responseTo) !== normalizeAddress(expected.payTo)) {
    return {
      ok: false,
      code: 'NO_MATCH',
      message: 'Payment sent to wrong address',
      detail: `Expected ${maskAddress(expected.payTo)}, got ${maskAddress(responseTo)}`
    }
  }

  // Validate chain matches
  if (normalizeIdentifier(responseChain) !== normalizeIdentifier(expected.chain)) {
    return {
      ok: false,
      code: 'WRONG_CHAIN',
      message: 'Payment sent on wrong blockchain network',
      detail: `Expected ${expected.chain}, got ${responseChain}`
    }
  }

  // Validate asset matches
  if (normalizeIdentifier(responseAsset) !== normalizeIdentifier(expected.asset)) {
    return {
      ok: false,
      code: 'WRONG_ASSET',
      message: 'Wrong cryptocurrency used for payment',
      detail: `Expected ${expected.asset}, got ${responseAsset}`
    }
  }

  // Validate amount is sufficient
  const amountPaid = typeof responseAmount === 'string' ? parseInt(responseAmount, 10) : responseAmount
  if (isNaN(amountPaid) || amountPaid < expected.amountAtomic) {
    return {
      ok: false,
      code: 'WRONG_AMOUNT',
      message: 'Payment amount is insufficient',
      detail: `Expected ${expected.amountAtomic}, got ${amountPaid}`
    }
  }

  return null // validation passed
}

/**
 * Single attempt to verify payment with facilitator
 */
async function attemptVerify(
  url: string,
  params: {
    chain: string
    asset: string
    amountAtomic: string | number
    payTo: string
    txHash: string
    tokenAddress?: string
    chainId?: number
  },
  _attemptNum: number
): Promise<{ res?: Response; error?: any }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const payload: any = {
      chain: params.chain,
      asset: params.asset,
      amountAtomic: String(params.amountAtomic),
      payTo: params.payTo,
      txHash: params.txHash
    }

    // Include tokenAddress and chainId if available (for RPC-aware facilitators)
    if (params.tokenAddress) {
      payload.tokenAddress = params.tokenAddress
    }
    if (params.chainId) {
      payload.chainId = params.chainId
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    return { res }
  } catch (error: any) {
    clearTimeout(timeoutId)

    // Distinguish timeout from other errors
    if (error.name === 'AbortError') {
      return { error: new Error('Request timeout after 10s') }
    }

    return { error }
  }
}

/**
 * ERC-3009 Authorization structure for facilitator verification
 */
export interface ERC3009Authorization {
  from: string          // payer address
  to: string           // recipient address
  value: string        // amount in atomic units
  validAfter: number   // unix timestamp
  validBefore: number  // unix timestamp
  nonce: string        // 32-byte hex nonce
  signature: string    // EIP-712 signature
}

/**
 * Verify ERC-3009 transferWithAuthorization via facilitator
 */
export async function facilitatorVerifyAuthorization(params: {
  chain: string
  asset: string
  amountAtomic: string | number
  payTo: string
  chainId: number
  tokenAddress: string
  authorization: ERC3009Authorization
}): Promise<VerifyResult> {
  const startTime = Date.now()
  const base = serverEnv.X402_FACILITATOR_URL
  const maskedFrom = maskAddress(params.authorization.from)

  console.log('[x402-facilitator] ERC-3009 verification started', {
    from: maskedFrom,
    to: maskAddress(params.payTo),
    chain: params.chain,
    asset: params.asset,
    scheme: 'erc3009'
  })

  // Pre-flight assertions: Ensure no leading zeros and lowercase addresses
  const normalizedAmountAtomic = asDecString(params.amountAtomic)
  const normalizedPayTo = params.payTo.toLowerCase()
  const normalizedTokenAddress = params.tokenAddress.toLowerCase()

  // Normalize authorization using wire format helper
  const normalizedAuth = normalizeAuthForWire({
    from: params.authorization.from,
    to: params.authorization.to,
    value: params.authorization.value,
    validAfter: params.authorization.validAfter,
    validBefore: params.authorization.validBefore,
    nonce: params.authorization.nonce,
    signature: params.authorization.signature
  })

  // Pre-flight invariant checks
  if (normalizedAuth.value !== normalizedAmountAtomic) {
    console.error('[x402-facilitator] Pre-flight validation failed: value mismatch', {
      authValue: normalizedAuth.value,
      amountAtomic: normalizedAmountAtomic
    })
    return {
      ok: false,
      code: 'WRONG_AMOUNT',
      message: 'Authorization value must equal amountAtomic',
      detail: `value=${normalizedAuth.value}, amountAtomic=${normalizedAmountAtomic}`
    }
  }

  if (normalizedAuth.to !== normalizedPayTo) {
    console.error('[x402-facilitator] Pre-flight validation failed: payTo mismatch', {
      authTo: normalizedAuth.to,
      payTo: normalizedPayTo
    })
    return {
      ok: false,
      code: 'NO_MATCH',
      message: 'Authorization "to" must equal payTo',
      detail: `to=${normalizedAuth.to}, payTo=${normalizedPayTo}`
    }
  }

  if (!/^0x[a-f0-9]{64}$/.test(normalizedAuth.nonce)) {
    console.error('[x402-facilitator] Pre-flight validation failed: invalid nonce format', {
      nonce: normalizedAuth.nonce
    })
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: 'Invalid nonce format (expected 0x + 64 hex chars)',
      detail: `nonce=${normalizedAuth.nonce}`
    }
  }

  if (!/^0x[a-f0-9]{130}$/.test(normalizedAuth.signature)) {
    console.error('[x402-facilitator] Pre-flight validation failed: invalid signature format', {
      sigLen: normalizedAuth.signature?.length
    })
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: 'Invalid signature format (expected 0x + 130 hex chars)',
      detail: `sigLen=${normalizedAuth.signature?.length}`
    }
  }

  // Build payload variants for multi-variant retry strategy
  // @ts-expect-error TODO(payment-types): serverEnv.X402_FACILITATOR_URL may be undefined in dev
  const baseUrl = joinFacilitator(base, 'verify')

  // Variant A: Canonical (chainId as number, all numerics as strings)
  const payloadA = {
    scheme: 'erc3009' as const,
    chainId: params.chainId, // number
    tokenAddress: normalizedTokenAddress,
    payTo: normalizedPayTo,
    amountAtomic: normalizedAmountAtomic,
    authorization: normalizedAuth
  }

  // Variant B: Canonical+ (chainId as string, signature at top level)
  const payloadB = {
    scheme: 'erc3009' as const,
    chainId: String(params.chainId), // string
    tokenAddress: normalizedTokenAddress,
    payTo: normalizedPayTo,
    amountAtomic: normalizedAmountAtomic,
    signature: normalizedAuth.signature, // duplicate signature at top level
    authorization: {
      from: normalizedAuth.from,
      to: normalizedAuth.to,
      value: normalizedAuth.value,
      validAfter: normalizedAuth.validAfter,
      validBefore: normalizedAuth.validBefore,
      nonce: normalizedAuth.nonce
    }
  }

  // Variant C: Legacy field names (some handlers expect these)
  const payloadC = {
    scheme: 'erc3009' as const,
    chain: params.chain, // 'base' or 'base-sepolia'
    asset: params.asset, // 'USDC'
    token: normalizedTokenAddress, // alias of tokenAddress
    recipient: normalizedPayTo, // alias of payTo
    amount: normalizedAmountAtomic, // alias of amountAtomic
    chainId: String(params.chainId), // include for compatibility
    signature: normalizedAuth.signature,
    authorization: {
      from: normalizedAuth.from,
      to: normalizedAuth.to,
      value: normalizedAuth.value,
      validAfter: normalizedAuth.validAfter,
      validBefore: normalizedAuth.validBefore,
      nonce: normalizedAuth.nonce
    }
  }

  // Multi-variant retry strategy
  const variants: Array<{ url: string; payload: typeof payloadA | typeof payloadB | typeof payloadC; variantName: string }> = [
    { url: baseUrl, payload: payloadA, variantName: 'canonical' },
    { url: baseUrl, payload: payloadB, variantName: 'canonical_plus' },
    { url: baseUrl, payload: payloadC, variantName: 'legacy' }
  ]

  let lastError: any
  let lastStatus: number | undefined

  for (let attempt = 0; attempt < variants.length; attempt++) {
    const variant = variants[attempt]

    console.log('[x402-facilitator] outgoing verify request', {
      url: variant.url,
      method: 'POST',
      variant: variant.variantName,
      attempt: attempt + 1,
      totalVariants: variants.length,
      payloadLength: JSON.stringify(variant.payload).length,
      scheme: variant.payload.scheme,
      chainId: variant.payload.chainId,
      chainIdType: typeof variant.payload.chainId,
      // @ts-expect-error TODO(payment-types): Discriminated union - properties exist on payloadA variant
      tokenAddress: maskAddress(variant.payload.tokenAddress),
      // @ts-expect-error TODO(payment-types): Discriminated union - properties exist on payloadA variant
      payTo: maskAddress(variant.payload.payTo),
      // @ts-expect-error TODO(payment-types): Discriminated union - properties exist on payloadA variant
      amountAtomic: variant.payload.amountAtomic,
      authFrom: maskAddress(variant.payload.authorization.from),
      authTo: maskAddress(variant.payload.authorization.to),
      authValue: variant.payload.authorization.value,
      authValidAfter: variant.payload.authorization.validAfter,
      authValidBefore: variant.payload.authorization.validBefore,
      authNonceLen: variant.payload.authorization.nonce?.length,
      // @ts-expect-error TODO(payment-types): Discriminated union - signature may be nested or top-level
      authSigLen: variant.payload.authorization.signature?.length || (variant.payload as any).signature?.length,
      // @ts-expect-error TODO(payment-types): Discriminated union - signature may be nested or top-level
      authSigHead: variant.payload.authorization.signature?.slice(0, 10) || (variant.payload as any).signature?.slice(0, 10),
      authNonceHead: variant.payload.authorization.nonce?.slice(0, 10),
      hasTopLevelSig: 'signature' in variant.payload
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const payloadJson = JSON.stringify(variant.payload)

      const res = await fetch(variant.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'accept': 'application/json',
          'user-agent': 'agent-dj-radio/1.0 (+x402)'
        },
        body: payloadJson,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      // Parse response
      const text = await res.text()
      const truncatedBody = text.length > 500 ? text.substring(0, 500) + '...[truncated]' : text

      let json: any = null
      try { json = text ? JSON.parse(text) : null } catch {}

      lastStatus = res.status

      // Handle non-2xx responses
      if (!res.ok) {
        console.warn('[x402-facilitator] Non-OK response (ERC-3009)', {
          from: maskedFrom,
          status: res.status,
          attempt: attempt + 1,
          body: truncatedBody
        })

        // Special case: 404/405 may indicate wrong path - retry with forced absolute path
        if (attempt === 0 && (res.status === 404 || res.status === 405)) {
          console.warn('[x402-facilitator] 404/405 detected - URL path may be incorrect', {
            from: maskedFrom,
            status: res.status,
            url: variant.url
          })

          // Try with forced absolute path from origin
          // @ts-expect-error TODO(payment-types): serverEnv.X402_FACILITATOR_URL may be undefined in dev
          const baseUrl = new URL(serverEnv.X402_FACILITATOR_URL)
          const forcedUrl = new URL('/facilitator/verify', baseUrl.origin).toString()

          console.log('[x402-facilitator] Retrying with forced absolute path', {
            from: maskedFrom,
            originalUrl: variant.url,
            forcedUrl
          })

          try {
            const forcedRes = await fetch(forcedUrl, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'accept': 'application/json'
              },
              body: payloadJson,
              signal: controller.signal
            })

            const forcedText = await forcedRes.text()
            const forcedTruncated = forcedText.length > 500 ? forcedText.substring(0, 500) + '...[truncated]' : forcedText

            if (forcedRes.ok) {
              console.log('[x402-facilitator] Forced path retry succeeded', {
                from: maskedFrom,
                status: forcedRes.status,
                forcedUrl
              })

              // Parse and continue with success flow
              try { json = forcedText ? JSON.parse(forcedText) : null } catch {}
              lastStatus = forcedRes.status

              // Continue to success validation below (reuse existing validation logic)
              if (json?.verified === true) {
                clearTimeout(timeoutId)

                // Strict field validation
                const validationError = validateResponse(json, {
                  chain: params.chain,
                  asset: params.asset,
                  payTo: params.payTo,
                  amountAtomic: typeof params.amountAtomic === 'string'
                    ? parseInt(params.amountAtomic, 10)
                    : params.amountAtomic
                })

                if (validationError) {
                  const durationMs = Date.now() - startTime
                  console.warn('[x402-facilitator] Validation failed (ERC-3009, forced path)', {
                    from: maskedFrom,
                    code: validationError.code,
                    detail: validationError.detail
                  })

                  incrementCounter('x402_verify_total', { mode: 'facilitator', code: validationError.code, scheme: 'erc3009' })
                  recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

                  return validationError
                }

                // Success!
                const durationMs = Date.now() - startTime
                const amountPaid = json.amountAtomic || json.amount

                console.log('[x402-facilitator] ERC-3009 verification successful (forced path)', {
                  from: maskedFrom,
                  amountPaid,
                  durationMs,
                  attempts: attempt + 1,
                  forcedUrl
                })

                incrementCounter('x402_verify_total', { mode: 'facilitator', code: 'success', scheme: 'erc3009' })
                recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

                return {
                  ok: true,
                  amountPaidAtomic: amountPaid,
                  tokenFrom: params.authorization.from,
                  providerRaw: json
                }
              }
            } else {
              console.warn('[x402-facilitator] Forced path retry also failed', {
                from: maskedFrom,
                status: forcedRes.status,
                body: forcedTruncated,
                forcedUrl
              })
            }
          } catch (forcedErr: any) {
            console.warn('[x402-facilitator] Forced path retry error', {
              from: maskedFrom,
              error: forcedErr?.message
            })
          }
        }

        // Special case: Try compatibility fallback for first 4xx/5xx error with empty body
        // Some facilitators may expect signature outside authorization object
        if (attempt === 0 && (res.status >= 400) && text.length === 0) {
          console.log('[x402-facilitator] Empty response body detected - trying compatibility fallback', {
            from: maskedFrom,
            status: res.status
          })

          // Build alternative payload structure (signature outside authorization)
          const compatPayload = {
            ...variant.payload,
            // @ts-expect-error TODO(payment-types): Discriminated union - signature may be nested
            signature: variant.payload.authorization.signature,
            authorization: {
              from: variant.payload.authorization.from,
              to: variant.payload.authorization.to,
              value: variant.payload.authorization.value,
              validAfter: variant.payload.authorization.validAfter,
              validBefore: variant.payload.authorization.validBefore,
              nonce: variant.payload.authorization.nonce
            }
          }

          console.log('[x402-facilitator] Retrying with compatibility payload', {
            from: maskedFrom,
            hasTopLevelSig: true
          })

          try {
            const compatRes = await fetch(variant.url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(compatPayload),
              signal: controller.signal
            })

            const compatText = await compatRes.text()
            const compatTruncated = compatText.length > 500 ? compatText.substring(0, 500) + '...[truncated]' : compatText

            if (compatRes.ok) {
              console.log('[x402-facilitator] Compatibility fallback succeeded', {
                from: maskedFrom,
                status: compatRes.status
              })

              // Parse and continue with success flow below
              try { json = compatText ? JSON.parse(compatText) : null } catch {}
              lastStatus = compatRes.status

              // Continue to success validation below
              if (json?.verified === true) {
                // Jump to success validation (reuse existing code)
                clearTimeout(timeoutId)

                // Strict field validation
                const validationError = validateResponse(json, {
                  chain: params.chain,
                  asset: params.asset,
                  payTo: params.payTo,
                  amountAtomic: typeof params.amountAtomic === 'string'
                    ? parseInt(params.amountAtomic, 10)
                    : params.amountAtomic
                })

                if (validationError) {
                  const durationMs = Date.now() - startTime
                  console.warn('[x402-facilitator] Validation failed (ERC-3009, compat)', {
                    from: maskedFrom,
                    code: validationError.code,
                    detail: validationError.detail
                  })

                  incrementCounter('x402_verify_total', { mode: 'facilitator', code: validationError.code, scheme: 'erc3009' })
                  recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

                  return validationError
                }

                // Success!
                const durationMs = Date.now() - startTime
                const amountPaid = json.amountAtomic || json.amount

                console.log('[x402-facilitator] ERC-3009 verification successful (compat fallback)', {
                  from: maskedFrom,
                  amountPaid,
                  durationMs,
                  attempts: attempt + 1
                })

                incrementCounter('x402_verify_total', { mode: 'facilitator', code: 'success', scheme: 'erc3009' })
                recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

                return {
                  ok: true,
                  amountPaidAtomic: amountPaid,
                  tokenFrom: params.authorization.from,
                  providerRaw: json
                }
              }
            } else {
              console.warn('[x402-facilitator] Compatibility fallback also failed', {
                from: maskedFrom,
                status: compatRes.status,
                body: compatTruncated
              })
            }
          } catch (compatErr: any) {
            console.warn('[x402-facilitator] Compatibility fallback error', {
              from: maskedFrom,
              error: compatErr?.message
            })
          }
        }

        // Check if retryable (5xx)
        if (attempt < MAX_ATTEMPTS - 1 && isRetryable(res.status)) {
          continue // retry
        }

        // Final attempt or 4xx (non-retryable)
        const durationMs = Date.now() - startTime
        const code = json?.error?.code ?? 'PROVIDER_ERROR'
        const msg = json?.error?.message ?? `Provider returned ${res.status}`

        incrementCounter('x402_verify_total', { mode: 'facilitator', code, scheme: 'erc3009' })
        recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

        return { ok: false, code, message: msg, detail: truncatedBody }
      }

      // Success response - validate
      if (json?.verified !== true) {
        const durationMs = Date.now() - startTime
        const code = json?.error?.code ?? 'NO_MATCH'
        const msg = json?.error?.message ?? 'Authorization not verified'

        incrementCounter('x402_verify_total', { mode: 'facilitator', code, scheme: 'erc3009' })
        recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

        return { ok: false, code, message: msg, detail: text }
      }

      // Strict field validation
      const validationError = validateResponse(json, {
        chain: params.chain,
        asset: params.asset,
        payTo: params.payTo,
        amountAtomic: typeof params.amountAtomic === 'string'
          ? parseInt(params.amountAtomic, 10)
          : params.amountAtomic
      })

      if (validationError) {
        const durationMs = Date.now() - startTime
        console.warn('[x402-facilitator] Validation failed (ERC-3009)', {
          from: maskedFrom,
          code: validationError.code,
          detail: validationError.detail
        })

        incrementCounter('x402_verify_total', { mode: 'facilitator', code: validationError.code, scheme: 'erc3009' })
        recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

        return validationError
      }

      // Success!
      const durationMs = Date.now() - startTime
      const amountPaid = json.amountAtomic || json.amount

      console.log('[x402-facilitator] ERC-3009 verification successful', {
        from: maskedFrom,
        amountPaid,
        durationMs,
        attempts: attempt + 1
      })

      incrementCounter('x402_verify_total', { mode: 'facilitator', code: 'success', scheme: 'erc3009' })
      recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

      return {
        ok: true,
        amountPaidAtomic: amountPaid,
        tokenFrom: params.authorization.from, // Payer is cryptographically bound in signature
        providerRaw: json
      }

    } catch (error: any) {
      clearTimeout(timeoutId)
      lastError = error

      console.warn('[x402-facilitator] Attempt failed (ERC-3009)', {
        from: maskedFrom,
        attempt: attempt + 1,
        error: error.message
      })

      // Check if retryable
      if (attempt < MAX_ATTEMPTS - 1 && isRetryable(undefined, error)) {
        continue // retry
      }

      // Final attempt or non-retryable
      const durationMs = Date.now() - startTime
      incrementCounter('x402_verify_total', { mode: 'facilitator', code: 'PROVIDER_ERROR', scheme: 'erc3009' })
      recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: error.message?.includes('timeout')
          ? 'Payment verification service timeout'
          : 'Payment verification service temporarily unavailable',
        detail: error.message
      }
    }
  }

  // Should not reach here, but handle gracefully
  const durationMs = Date.now() - startTime
  incrementCounter('x402_verify_total', { mode: 'facilitator', code: 'PROVIDER_ERROR', scheme: 'erc3009' })
  recordLatency('x402_verify_latency_ms', { mode: 'facilitator', scheme: 'erc3009' }, durationMs)

  return {
    ok: false,
    code: 'PROVIDER_ERROR',
    message: 'ERC-3009 verification failed after retries',
    detail: lastError?.message || `Last status: ${lastStatus}`
  }
}

/**
 * Verify transaction hash via facilitator (original txHash-based flow)
 */
export async function facilitatorVerify(params: {
  chain: string
  asset: string
  amountAtomic: string | number
  payTo: string
  txHash: string
  tokenAddress?: string
  chainId?: number
}): Promise<VerifyResult> {
  const startTime = Date.now()
  const base = serverEnv.X402_FACILITATOR_URL
  // @ts-expect-error TODO(payment-types): base may be undefined in dev
  const url = joinFacilitator(base, 'verify')
  const maskedTx = maskTxHash(params.txHash)

  console.log('[x402-facilitator] Verification started', {
    txHash: maskedTx,
    chain: params.chain,
    asset: params.asset,
    payTo: maskAddress(params.payTo)
  })

  let lastError: any
  let lastStatus: number | undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Add retry delay (skip for first attempt)
    if (attempt > 0) {
      const baseDelay = RETRY_DELAYS_MS[attempt - 1]
      const delayMs = addJitter(baseDelay)
      console.log(`[x402-facilitator] Retry attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delayMs}ms`, {
        txHash: maskedTx
      })
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    const { res, error } = await attemptVerify(url, params, attempt + 1)

    // Handle fetch errors
    if (error) {
      lastError = error
      console.warn('[x402-facilitator] Attempt failed', {
        txHash: maskedTx,
        attempt: attempt + 1,
        error: error.message
      })

      // Check if retryable
      if (attempt < MAX_ATTEMPTS - 1 && isRetryable(undefined, error)) {
        continue // retry
      }

      // Final attempt or non-retryable
      const durationMs = Date.now() - startTime
      incrementCounter('x402_verify_total', { mode: 'facilitator', code: 'PROVIDER_ERROR' })
      recordLatency('x402_verify_latency_ms', { mode: 'facilitator' }, durationMs)

      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: error.message?.includes('timeout')
          ? 'Payment verification service timeout'
          : 'Payment verification service temporarily unavailable',
        detail: error.message
      }
    }

    // Parse response
    const text = await res!.text()
    // Truncate response body to 500 chars for logging
    const truncatedBody = text.length > 500 ? text.substring(0, 500) + '...[truncated]' : text

    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch {}

    lastStatus = res!.status

    // Handle non-2xx responses
    if (!res!.ok) {
      console.warn('[x402-facilitator] Non-OK response', {
        txHash: maskedTx,
        status: res!.status,
        attempt: attempt + 1,
        body: truncatedBody
      })

      // Check if retryable (5xx)
      if (attempt < MAX_ATTEMPTS - 1 && isRetryable(res!.status)) {
        continue // retry
      }

      // Final attempt or 4xx (non-retryable)
      const durationMs = Date.now() - startTime
      const code = json?.error?.code ?? 'PROVIDER_ERROR'
      const msg = json?.error?.message ?? `Provider returned ${res!.status}`

      incrementCounter('x402_verify_total', { mode: 'facilitator', code })
      recordLatency('x402_verify_latency_ms', { mode: 'facilitator' }, durationMs)

      return { ok: false, code, message: msg, detail: truncatedBody }
    }

    // Success response - validate
    if (json?.verified !== true) {
      const durationMs = Date.now() - startTime
      const code = json?.error?.code ?? 'NO_MATCH'
      const msg = json?.error?.message ?? 'Transaction not found or does not match'

      incrementCounter('x402_verify_total', { mode: 'facilitator', code })
      recordLatency('x402_verify_latency_ms', { mode: 'facilitator' }, durationMs)

      return { ok: false, code, message: msg, detail: text }
    }

    // Strict field validation
    const validationError = validateResponse(json, {
      chain: params.chain,
      asset: params.asset,
      payTo: params.payTo,
      amountAtomic: typeof params.amountAtomic === 'string'
        ? parseInt(params.amountAtomic, 10)
        : params.amountAtomic
    })

    if (validationError) {
      const durationMs = Date.now() - startTime
      console.warn('[x402-facilitator] Validation failed', {
        txHash: maskedTx,
        code: validationError.code,
        detail: validationError.detail
      })

      incrementCounter('x402_verify_total', { mode: 'facilitator', code: validationError.code })
      recordLatency('x402_verify_latency_ms', { mode: 'facilitator' }, durationMs)

      return validationError
    }

    // Success!
    const durationMs = Date.now() - startTime
    const amountPaid = json.amountAtomic || json.amount

    console.log('[x402-facilitator] Verification successful', {
      txHash: maskedTx,
      amountPaid,
      durationMs,
      attempts: attempt + 1
    })

    incrementCounter('x402_verify_total', { mode: 'facilitator', code: 'success' })
    recordLatency('x402_verify_latency_ms', { mode: 'facilitator' }, durationMs)

    return {
      ok: true,
      amountPaidAtomic: amountPaid,
      providerRaw: json
    }
  }

  // Should not reach here, but handle gracefully
  const durationMs = Date.now() - startTime
  incrementCounter('x402_verify_total', { mode: 'facilitator', code: 'PROVIDER_ERROR' })
  recordLatency('x402_verify_latency_ms', { mode: 'facilitator' }, durationMs)

  return {
    ok: false,
    code: 'PROVIDER_ERROR',
    message: 'Payment verification failed after retries',
    detail: lastError?.message || `Last status: ${lastStatus}`
  }
}
