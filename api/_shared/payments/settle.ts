// api/_shared/payments/settle.ts
// X402 settlement layer: facilitator settle API + local broadcast fallback
// Explicit settlement step after signature verification

import { createWalletClient, createPublicClient, http, encodeFunctionData } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { serverEnv } from '../../../src/config/env.server.js'
import { logger } from '../../../src/lib/logger.js'
import { maskTxHash, maskAddress } from '../../../src/lib/crypto-utils.js'

// ============================================================================
// TYPES
// ============================================================================

export interface ERC3009Authorization {
  from: string          // payer address
  to: string           // recipient address
  value: string        // amount in atomic units
  validAfter: number   // unix timestamp
  validBefore: number  // unix timestamp
  nonce: string        // 32-byte hex nonce
  signature: string    // EIP-712 signature (0x + 130 hex chars)
}

export interface SettleContext {
  facilitatorUrl?: string
  apiKey?: string
  challenge: {
    challenge_id: string
    pay_to: string
    amount_atomic: string | number
    nonce: string
  }
  requestId: string
}

export interface LocalSettleContext {
  privateKey: string
  rpcUrl: string
  usdcContract: string
  challenge: {
    pay_to: string
    amount_atomic: string | number
  }
  requestId: string
}

// ============================================================================
// ERC-3009 ABI (minimal)
// ============================================================================

const TRANSFER_WITH_AUTH_ABI = [{
  name: 'transferWithAuthorization',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' },
    { name: 's', type: 'bytes32' }
  ],
  outputs: []
}] as const

// ============================================================================
// SIGNATURE UTILITIES
// ============================================================================

/**
 * Split EIP-2098 compact signature into {v, r, s} components
 *
 * EIP-2098: 65 bytes = 130 hex chars (r:32, s:32, v:1)
 * - Bytes 0-31: r (recovery id x-coordinate)
 * - Bytes 32-63: s (recovery id y-coordinate)
 * - Byte 64: v (recovery id, typically 27 or 28)
 *
 * @param signature - 0x-prefixed 130-char hex string
 * @returns {v, r, s} components for EVM signature verification
 */
export function splitSignature(signature: string): {
  v: number
  r: `0x${string}`
  s: `0x${string}`
} {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error(`Invalid signature format: expected 0x + 130 hex chars, got ${signature.length} chars`)
  }

  const r = `0x${signature.slice(2, 66)}` as `0x${string}`
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`
  const vHex = signature.slice(130, 132)
  const v = parseInt(vHex, 16)

  // EIP-155: v should be 27 or 28 (legacy) or chainId * 2 + 35/36 (EIP-155)
  // For ERC-3009, typically 27 or 28
  if (v !== 27 && v !== 28 && v < 35) {
    logger.warn('Unusual v value in signature', { v, vHex })
  }

  return { v, r, s }
}

/**
 * Mask API key for logging (show first 6 + last 4 chars)
 */
function maskApiKey(key: string): string {
  if (!key || key.length < 10) return '(invalid)'
  return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`
}

// ============================================================================
// FACILITATOR SETTLE
// ============================================================================

const FACILITATOR_TIMEOUT_MS = 10000 // 10s per attempt
const FACILITATOR_RETRY_DELAYS_MS = [300, 800] // 2 retries with jitter
const MAX_FACILITATOR_ATTEMPTS = 1 + FACILITATOR_RETRY_DELAYS_MS.length

/**
 * Add jitter to retry delay (±25% randomization)
 */
function addJitter(baseMs: number): number {
  const jitter = baseMs * 0.25
  return Math.floor(baseMs + (Math.random() * 2 - 1) * jitter)
}

/**
 * Check if HTTP status is retryable (5xx)
 */
function isRetryable(status?: number): boolean {
  return status ? status >= 500 : false
}

/**
 * Settle ERC-3009 authorization via facilitator REST API
 *
 * POST ${facilitatorUrl}/settle
 * Authorization: Bearer ${apiKey}
 *
 * Request:
 * {
 *   "scheme": "erc3009",
 *   "chainId": 8453,
 *   "tokenAddress": "0x833589...",
 *   "authorization": { from, to, value, validAfter, validBefore, nonce, signature }
 * }
 *
 * Success response:
 * {
 *   "settled": true,
 *   "txHash": "0x..."
 * }
 *
 * @returns txHash if facilitator settles successfully, null otherwise (triggers fallback)
 */
export async function settleWithFacilitator(
  authorization: ERC3009Authorization,
  ctx: SettleContext
): Promise<string | null> {
  const startTime = Date.now()

  if (!ctx.facilitatorUrl) {
    logger.warn('settleWithFacilitator called but no facilitatorUrl configured', {
      requestId: ctx.requestId,
      challengeId: ctx.challenge.challenge_id
    })
    return null
  }

  // Build settle URL (default to /settle path if not explicitly configured)
  const settleUrl = serverEnv.FACILITATOR_SETTLE_URL || `${ctx.facilitatorUrl}/settle`

  logger.info('settleWithFacilitator: starting', {
    requestId: ctx.requestId,
    challengeId: ctx.challenge.challenge_id,
    from: maskAddress(authorization.from),
    to: maskAddress(authorization.to),
    value: authorization.value,
    settleUrl: settleUrl.substring(0, 50) + '...',
    hasApiKey: !!ctx.apiKey
  })

  // Build payload
  const payload = {
    scheme: 'erc3009' as const,
    chainId: serverEnv.X402_CHAIN_ID,
    tokenAddress: serverEnv.X402_TOKEN_ADDRESS,
    authorization: {
      from: authorization.from.toLowerCase(),
      to: authorization.to.toLowerCase(),
      value: authorization.value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce.toLowerCase(),
      signature: authorization.signature.toLowerCase()
    }
  }

  let lastError: any
  let lastStatus: number | undefined

  // Bounded retry with jitter
  for (let attempt = 0; attempt < MAX_FACILITATOR_ATTEMPTS; attempt++) {
    // Add retry delay (skip for first attempt)
    if (attempt > 0) {
      const baseDelay = FACILITATOR_RETRY_DELAYS_MS[attempt - 1]
      const delayMs = addJitter(baseDelay)
      logger.debug('settleWithFacilitator: retry delay', {
        requestId: ctx.requestId,
        attempt: attempt + 1,
        delayMs
      })
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FACILITATOR_TIMEOUT_MS)

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json; charset=utf-8',
        'accept': 'application/json',
        'user-agent': 'agent-dj-radio/1.0 (+x402-settle)'
      }

      // Add bearer token if provided
      if (ctx.apiKey) {
        headers['authorization'] = `Bearer ${ctx.apiKey}`
      }

      logger.debug('settleWithFacilitator: outgoing request', {
        requestId: ctx.requestId,
        attempt: attempt + 1,
        url: settleUrl,
        payloadSize: JSON.stringify(payload).length,
        hasAuth: !!ctx.apiKey,
        apiKeyPreview: ctx.apiKey ? maskApiKey(ctx.apiKey) : 'none'
      })

      const res = await fetch(settleUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      })

      clearTimeout(timeoutId)
      lastStatus = res.status

      const text = await res.text()
      const truncatedBody = text.length > 500 ? text.substring(0, 500) + '...[truncated]' : text

      let json: any = null
      try {
        json = text ? JSON.parse(text) : null
      } catch (parseErr) {
        logger.warn('settleWithFacilitator: failed to parse response', {
          requestId: ctx.requestId,
          status: res.status,
          bodyPreview: truncatedBody.substring(0, 100)
        })
      }

      // Handle non-2xx responses
      if (!res.ok) {
        logger.warn('settleWithFacilitator: non-OK response', {
          requestId: ctx.requestId,
          status: res.status,
          attempt: attempt + 1,
          bodyPreview: truncatedBody.substring(0, 200)
        })

        // 404/405: Endpoint doesn't exist → return null (fallback to local)
        if (res.status === 404 || res.status === 405) {
          logger.info('settleWithFacilitator: endpoint not found (404/405), returning null', {
            requestId: ctx.requestId,
            status: res.status
          })
          return null
        }

        // 503: Service unavailable → return null (fallback)
        if (res.status === 503) {
          logger.info('settleWithFacilitator: service unavailable (503), returning null', {
            requestId: ctx.requestId
          })
          return null
        }

        // Check if retryable (5xx)
        if (attempt < MAX_FACILITATOR_ATTEMPTS - 1 && isRetryable(res.status)) {
          logger.debug('settleWithFacilitator: retryable error, will retry', {
            requestId: ctx.requestId,
            status: res.status,
            attempt: attempt + 1
          })
          continue // retry
        }

        // Final attempt or non-retryable (4xx)
        logger.warn('settleWithFacilitator: failed after retries', {
          requestId: ctx.requestId,
          status: res.status,
          attempts: attempt + 1,
          code: json?.error?.code
        })
        return null
      }

      // Success response - extract txHash
      const txHash = json?.txHash || json?.tx_hash || json?.transactionHash

      if (!txHash || typeof txHash !== 'string') {
        logger.warn('settleWithFacilitator: success response but no txHash', {
          requestId: ctx.requestId,
          status: res.status,
          hasSettled: json?.settled,
          responseKeys: json ? Object.keys(json) : []
        })
        return null
      }

      // Validate txHash format (0x + 64 hex chars)
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        logger.warn('settleWithFacilitator: invalid txHash format', {
          requestId: ctx.requestId,
          txHashPreview: txHash.substring(0, 20) + '...',
          length: txHash.length
        })
        return null
      }

      // Success!
      const durationMs = Date.now() - startTime
      logger.info('settleWithFacilitator: success', {
        requestId: ctx.requestId,
        challengeId: ctx.challenge.challenge_id,
        txHash: maskTxHash(txHash),
        durationMs,
        attempts: attempt + 1
      })

      return txHash

    } catch (error: any) {
      clearTimeout(timeoutId)
      lastError = error

      logger.warn('settleWithFacilitator: fetch error', {
        requestId: ctx.requestId,
        attempt: attempt + 1,
        error: error.message,
        isTimeout: error.name === 'AbortError'
      })

      // Check if retryable (network errors)
      if (attempt < MAX_FACILITATOR_ATTEMPTS - 1) {
        continue // retry
      }

      // Final attempt
      logger.warn('settleWithFacilitator: failed after all retries', {
        requestId: ctx.requestId,
        error: error.message,
        attempts: attempt + 1
      })
      return null
    }
  }

  // Should not reach here, but handle gracefully
  const durationMs = Date.now() - startTime
  logger.warn('settleWithFacilitator: exhausted all attempts', {
    requestId: ctx.requestId,
    lastError: lastError?.message,
    lastStatus,
    durationMs
  })

  return null
}

// ============================================================================
// LOCAL SETTLE (BROADCAST ERC-3009)
// ============================================================================

/**
 * Settle ERC-3009 authorization locally by broadcasting to Base mainnet
 *
 * Pre-flight validation:
 * - authorization.to === challenge.pay_to
 * - authorization.value >= challenge.amount_atomic
 * - validBefore is still in-window (not expired)
 *
 * Broadcast:
 * - Uses SETTLER_PRIVATE_KEY to broadcast transferWithAuthorization()
 * - Returns txHash on success
 * - Throws on validation errors or RPC errors
 *
 * @throws Error with VALIDATION_ERROR or PROVIDER_ERROR codes
 */
export async function settleLocally(
  authorization: ERC3009Authorization,
  ctx: LocalSettleContext
): Promise<string> {
  const startTime = Date.now()

  logger.info('settleLocally: starting', {
    requestId: ctx.requestId,
    from: maskAddress(authorization.from),
    to: maskAddress(authorization.to),
    value: authorization.value,
    rpcUrl: ctx.rpcUrl.substring(0, 30) + '...',
    usdcContract: maskAddress(ctx.usdcContract)
  })

  // ============================================================================
  // PRE-FLIGHT VALIDATION (security critical!)
  // ============================================================================

  // 1. Recipient must match challenge payTo
  const normalizedAuthTo = authorization.to.toLowerCase()
  const normalizedPayTo = ctx.challenge.pay_to.toLowerCase()

  if (normalizedAuthTo !== normalizedPayTo) {
    logger.error('settleLocally: VALIDATION_ERROR - recipient mismatch', {
      requestId: ctx.requestId,
      authTo: maskAddress(authorization.to),
      challengePayTo: maskAddress(ctx.challenge.pay_to)
    })
    throw new Error(`VALIDATION_ERROR: authorization.to (${maskAddress(authorization.to)}) !== challenge.pay_to (${maskAddress(ctx.challenge.pay_to)})`)
  }

  // 2. Amount must be sufficient
  const authValue = BigInt(authorization.value)
  const challengeAmount = BigInt(ctx.challenge.amount_atomic)

  if (authValue < challengeAmount) {
    logger.error('settleLocally: VALIDATION_ERROR - insufficient amount', {
      requestId: ctx.requestId,
      authValue: authValue.toString(),
      challengeAmount: challengeAmount.toString()
    })
    throw new Error(`VALIDATION_ERROR: authorization.value (${authValue}) < challenge.amount_atomic (${challengeAmount})`)
  }

  // 3. Check validBefore is still in-window (allow 60s clock skew)
  const nowUnix = Math.floor(Date.now() / 1000)
  const clockSkewSeconds = 60

  if (authorization.validBefore <= nowUnix - clockSkewSeconds) {
    logger.error('settleLocally: VALIDATION_ERROR - authorization expired', {
      requestId: ctx.requestId,
      validBefore: authorization.validBefore,
      now: nowUnix,
      expired: true
    })
    throw new Error(`VALIDATION_ERROR: authorization expired (validBefore=${authorization.validBefore}, now=${nowUnix})`)
  }

  // 4. Validate signature format
  if (!/^0x[0-9a-fA-F]{130}$/.test(authorization.signature)) {
    logger.error('settleLocally: VALIDATION_ERROR - invalid signature format', {
      requestId: ctx.requestId,
      signatureLength: authorization.signature.length
    })
    throw new Error(`VALIDATION_ERROR: invalid signature format (expected 0x + 130 hex chars)`)
  }

  logger.info('settleLocally: pre-flight validation passed', {
    requestId: ctx.requestId,
    checks: ['recipient_match', 'amount_sufficient', 'not_expired', 'signature_valid']
  })

  // ============================================================================
  // SIGNATURE SPLITTING
  // ============================================================================

  let v: number, r: `0x${string}`, s: `0x${string}`

  try {
    const sig = splitSignature(authorization.signature)
    v = sig.v
    r = sig.r
    s = sig.s

    logger.debug('settleLocally: signature split', {
      requestId: ctx.requestId,
      v,
      rPreview: r.substring(0, 10) + '...',
      sPreview: s.substring(0, 10) + '...'
    })
  } catch (err) {
    logger.error('settleLocally: failed to split signature', {
      requestId: ctx.requestId,
      error: (err as Error).message
    })
    throw new Error(`VALIDATION_ERROR: ${(err as Error).message}`)
  }

  // ============================================================================
  // WALLET CLIENT SETUP
  // ============================================================================

  let account: ReturnType<typeof privateKeyToAccount>

  try {
    account = privateKeyToAccount(ctx.privateKey as `0x${string}`)

    logger.info('settleLocally: wallet account loaded', {
      requestId: ctx.requestId,
      settlerAddress: maskAddress(account.address)
    })
  } catch (err) {
    logger.error('settleLocally: failed to load private key', {
      requestId: ctx.requestId,
      error: (err as Error).message
    })
    throw new Error(`PROVIDER_ERROR: failed to load settler private key - ${(err as Error).message}`)
  }

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(ctx.rpcUrl)
  })

  // ============================================================================
  // GAS ESTIMATION (optional, for observability)
  // ============================================================================

  const publicClient = createPublicClient({
    chain: base,
    transport: http(ctx.rpcUrl)
  })

  let gasEstimate: bigint | undefined

  try {
    gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: ctx.usdcContract as `0x${string}`,
      data: encodeFunctionData({
        abi: TRANSFER_WITH_AUTH_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          authorization.from as `0x${string}`,
          authorization.to as `0x${string}`,
          authValue,
          BigInt(authorization.validAfter),
          BigInt(authorization.validBefore),
          authorization.nonce as `0x${string}`,
          v,
          r,
          s
        ]
      })
    })

    logger.info('settleLocally: gas estimation', {
      requestId: ctx.requestId,
      gasEstimate: gasEstimate.toString()
    })
  } catch (estimateErr) {
    logger.warn('settleLocally: gas estimation failed (non-fatal)', {
      requestId: ctx.requestId,
      error: (estimateErr as Error).message
    })
    // Continue without gas estimate
  }

  // ============================================================================
  // BROADCAST TRANSACTION
  // ============================================================================

  let txHash: string

  try {
    const hash = await walletClient.writeContract({
      address: ctx.usdcContract as `0x${string}`,
      abi: TRANSFER_WITH_AUTH_ABI,
      functionName: 'transferWithAuthorization',
      args: [
        authorization.from as `0x${string}`,
        authorization.to as `0x${string}`,
        authValue,
        BigInt(authorization.validAfter),
        BigInt(authorization.validBefore),
        authorization.nonce as `0x${string}`,
        v,
        r,
        s
      ]
    })

    txHash = hash

    const durationMs = Date.now() - startTime

    logger.info('settleLocally: broadcast success', {
      requestId: ctx.requestId,
      txHash: maskTxHash(txHash),
      durationMs,
      gasEstimate: gasEstimate?.toString(),
      from: maskAddress(authorization.from),
      to: maskAddress(authorization.to),
      value: authValue.toString()
    })

    return txHash

  } catch (broadcastErr: any) {
    const durationMs = Date.now() - startTime

    logger.error('settleLocally: broadcast failed', {
      requestId: ctx.requestId,
      error: broadcastErr.message,
      errorCode: broadcastErr.code,
      durationMs
    })

    throw new Error(`PROVIDER_ERROR: local broadcast failed - ${broadcastErr.message}`)
  }
}
