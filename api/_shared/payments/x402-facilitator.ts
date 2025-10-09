// api/_shared/payments/x402-facilitator.ts
// x402 facilitator payment verification using REST API (for testnet/Base Sepolia)
// Hardened with timeouts, retries, strict validation, and observability

import { serverEnv } from '../../../src/config/env.server.js'
import { maskTxHash, maskAddress, normalizeAddress, normalizeIdentifier } from '../../../src/lib/crypto-utils.js'
import { incrementCounter, recordLatency } from '../../../src/lib/metrics.js'

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
  attemptNum: number
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
  const url = `${base.replace(/\/$/, '')}/verify`
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
