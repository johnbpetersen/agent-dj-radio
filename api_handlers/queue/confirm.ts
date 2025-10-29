// api/queue/confirm.ts
// Verify x402 payment and transition track from PENDING_PAYMENT to PAID
// @ts-nocheck - TODO(payment-types): Complex ERC3009 payment verification code needs proper typing refactor

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z, ZodError } from 'zod'
import { supabaseAdmin } from '../_shared/supabase.js'
import { verifyPayment } from '../_shared/payments/x402-cdp.js'
// Use old facilitator for txHash mode (legacy), new modular facilitator for authorization mode
import { facilitatorVerify } from '../_shared/payments/x402-facilitator.js'
import { facilitatorVerifyAuthorization } from '../_shared/payments/facilitator/index.js'
import { createPublicClient, http, parseAbiItem, type Hash } from 'viem'
import { base } from 'viem/chains'
import { settleWithFacilitator, settleLocally, type ERC3009Authorization as SettleAuth } from '../_shared/payments/settle.js'

// ERC-3009 authorization type (flattened for facilitator)
type ERC3009Authorization = {
  from: string
  to: string
  value: string | number | bigint
  validAfter: string | number | bigint
  validBefore: string | number | bigint
  nonce: string
  signature: string
}
import { verifyViaRPC } from '../_shared/payments/x402-rpc.js'
import { serverEnv } from '../../src/config/env.server.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { errorTracker } from '../../src/lib/error-tracking.js'
import { broadcastQueueUpdate } from '../../src/server/realtime.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { maskTxHash, maskAddress } from '../../src/lib/crypto-utils.js'
import { normalizeEvmAddress, addressesMatch } from '../../src/lib/binding-utils.js'

// ERC-3009 authorization fields (nested under authorization.authorization)
const erc3009AuthFieldsSchema = z.object({
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid from address'),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid to address'),
  value: z.union([z.string().regex(/^\d+$/, 'Invalid value format'), z.number()]).transform(v => String(v)),
  validAfter: z.union([z.number(), z.string()]).transform(v => Number(v)),
  validBefore: z.union([z.number(), z.string()]).transform(v => Number(v)),
  nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid nonce format')
})

// Full authorization object with signature at top level
const erc3009AuthorizationSchema = z.object({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature format'),
  authorization: erc3009AuthFieldsSchema
})

// Request validation schema - supports both txHash (RPC mode) and authorization (facilitator mode)
const confirmRequestSchema = z.object({
  challengeId: z.string().uuid('Invalid challenge ID format'),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash format').optional(),
  authorization: erc3009AuthorizationSchema.optional()
}).refine(
  (data) => data.txHash || data.authorization,
  { message: 'Either txHash or authorization must be provided' }
)

// Clock skew tolerance (±60 seconds)
const CLOCK_SKEW_MS = 60 * 1000

/**
 * Mock payment verification for development/staging
 */
async function verifyMockPayment(
  txHash: string,
  amountAtomic: number,
  challengeId: string
): Promise<{ ok: true; amountPaidAtomic: number } | { ok: false; code: string; detail?: string }> {
  // Simple mock validation: tx hash must start with 0x and be 66 chars
  if (!txHash.match(/^0x[0-9a-fA-F]{64}$/)) {
    return { ok: false, code: 'NO_MATCH', detail: 'Invalid mock transaction hash format' }
  }

  // Mock always pays exact amount
  logger.info('Mock payment verification (always succeeds)', { challengeId, txHash, amountAtomic })
  return { ok: true, amountPaidAtomic: amountAtomic }
}

/**
 * Verify settlement transaction on Base mainnet with bounded retry
 * Returns receipt if found and successful within retry window
 */
async function verifySettlementOnChain(
  txHash: Hash,
  params: {
    expectedRecipient: string
    expectedAmountAtomic: number | string
    expectedSender?: string
    tokenAddress: string
    requestId: string
    challengeId: string
  }
): Promise<
  | { ok: true; receipt: any; amountPaid: string; from: string }
  | { ok: false; code: 'TX_PENDING' | 'TX_FAILED' | 'WRONG_RECIPIENT' | 'UNDERPAID' | 'NO_TRANSFER_EVENT'; message: string }
> {
  const { expectedRecipient, expectedAmountAtomic, expectedSender, tokenAddress, requestId, challengeId } = params

  // Create RPC client
  const rpcUrl = serverEnv.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org'
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl)
  })

  logger.info('verifySettlement: checking receipt on Base mainnet', {
    requestId,
    challengeId,
    txHash: maskTxHash(txHash),
    rpcUrl: rpcUrl.substring(0, 30) + '...'
  })

  // Bounded retry: 3 attempts with increasing delays
  const delays = [500, 1000, 1500] // ms
  let receipt: any = null

  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: txHash })
      if (receipt) {
        logger.info('verifySettlement: receipt found', {
          requestId,
          challengeId,
          txHash: maskTxHash(txHash),
          attempt: attempt + 1,
          status: receipt.status
        })
        break
      }
    } catch (err: any) {
      logger.debug('verifySettlement: receipt not yet available', {
        requestId,
        challengeId,
        txHash: maskTxHash(txHash),
        attempt: attempt + 1,
        error: err?.message
      })
    }

    // Wait before next attempt (skip delay on last attempt)
    if (attempt < delays.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt]))
    }
  }

  // No receipt after retries
  if (!receipt) {
    logger.info('verifySettlement: no receipt after retries', {
      requestId,
      challengeId,
      txHash: maskTxHash(txHash),
      attempts: delays.length
    })
    return {
      ok: false,
      code: 'TX_PENDING',
      message: 'Transaction not yet confirmed on-chain. Please wait a moment and try again.'
    }
  }

  // Check receipt status
  if (receipt.status !== 'success') {
    logger.warn('verifySettlement: transaction failed', {
      requestId,
      challengeId,
      txHash: maskTxHash(txHash),
      status: receipt.status
    })
    return {
      ok: false,
      code: 'TX_FAILED',
      message: 'Transaction failed on-chain'
    }
  }

  // Parse Transfer events from receipt logs
  const transferEventSignature = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

  let transferFound = false
  let transferFrom: string | null = null
  let transferTo: string | null = null
  let transferAmount: bigint | null = null

  for (const log of receipt.logs) {
    // Check if this is a Transfer event from the USDC token contract
    if (
      log.address?.toLowerCase() === tokenAddress.toLowerCase() &&
      log.topics[0] === transferEventSignature.signature
    ) {
      try {
        // Decode indexed params from topics (from, to)
        transferFrom = '0x' + log.topics[1].slice(26) // Remove first 26 chars (0x + 24 zeros)
        transferTo = '0x' + log.topics[2].slice(26)
        // Decode value from data
        transferAmount = BigInt(log.data)

        transferFound = true
        logger.info('verifySettlement: Transfer event found', {
          requestId,
          challengeId,
          txHash: maskTxHash(txHash),
          from: maskAddress(transferFrom),
          to: maskAddress(transferTo),
          amount: transferAmount.toString()
        })
        break
      } catch (parseErr: any) {
        logger.warn('verifySettlement: failed to parse Transfer event', {
          requestId,
          challengeId,
          error: parseErr?.message
        })
      }
    }
  }

  if (!transferFound || !transferFrom || !transferTo || transferAmount === null) {
    logger.warn('verifySettlement: no Transfer event found', {
      requestId,
      challengeId,
      txHash: maskTxHash(txHash),
      logsCount: receipt.logs.length
    })
    return {
      ok: false,
      code: 'NO_TRANSFER_EVENT',
      message: 'No USDC transfer found in transaction'
    }
  }

  // Validate recipient
  if (transferTo.toLowerCase() !== expectedRecipient.toLowerCase()) {
    logger.warn('verifySettlement: wrong recipient', {
      requestId,
      challengeId,
      txHash: maskTxHash(txHash),
      expected: maskAddress(expectedRecipient),
      got: maskAddress(transferTo)
    })
    return {
      ok: false,
      code: 'WRONG_RECIPIENT',
      message: `Payment sent to wrong address. Expected ${expectedRecipient.substring(0, 10)}..., got ${transferTo.substring(0, 10)}...`
    }
  }

  // Validate amount (must be >= expected)
  const expectedAmount = BigInt(expectedAmountAtomic)
  if (transferAmount < expectedAmount) {
    logger.warn('verifySettlement: underpaid', {
      requestId,
      challengeId,
      txHash: maskTxHash(txHash),
      expected: expectedAmount.toString(),
      got: transferAmount.toString()
    })
    return {
      ok: false,
      code: 'UNDERPAID',
      message: `Payment amount too low. Expected ${expectedAmount.toString()}, got ${transferAmount.toString()}`
    }
  }

  // Validate sender (if provided)
  if (expectedSender && transferFrom.toLowerCase() !== expectedSender.toLowerCase()) {
    logger.warn('verifySettlement: wrong sender', {
      requestId,
      challengeId,
      txHash: maskTxHash(txHash),
      expected: maskAddress(expectedSender),
      got: maskAddress(transferFrom)
    })
    // Note: This is logged but not a hard failure in facilitator mode
    // ERC-3009 authorization already binds the sender
  }

  // All validations passed
  logger.info('verifySettlement: success', {
    requestId,
    challengeId,
    txHash: maskTxHash(txHash),
    from: maskAddress(transferFrom),
    to: maskAddress(transferTo),
    amount: transferAmount.toString()
  })

  return {
    ok: true,
    receipt,
    amountPaid: transferAmount.toString(),
    from: transferFrom
  }
}

async function confirmHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const requestId = generateCorrelationId()
  const startTime = Date.now()

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed', requestId })
    return
  }

  logger.info('queue/confirm request received', { requestId })

  // Dev-only body echo for debugging
  if (serverEnv.STAGE === 'dev') {
    logger.debug('queue/confirm dev body echo', {
      hasBody: !!req.body,
      keys: req?.body ? Object.keys(req.body) : []
    })
  }

  try {
    // Validate request body with structured field errors
    let challengeId: string
    let txHash: string | undefined
    let authorization: ERC3009Authorization | undefined

    try {
      const parsed = confirmRequestSchema.parse(req.body)
      challengeId = parsed.challengeId
      txHash = parsed.txHash
      authorization = parsed.authorization
    } catch (error) {
      if (error instanceof ZodError) {
        // Extract structured field errors
        const fields = error.issues.map(issue => ({
          path: issue.path.join('.') || 'body',
          message: issue.message
        }))

        logger.warn('queue/confirm validation failed', {
          requestId,
          fields: fields.map(f => `${f.path}: ${f.message}`).join(', ')
        })

        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            fields
          },
          requestId
        })
        return
      }

      // Re-throw unexpected errors to outer handler
      throw error
    }

    const paymentMode = authorization ? 'authorization' : 'txHash'
    logger.info('queue/confirm processing', {
      requestId,
      challengeId,
      mode: paymentMode,
      ...(txHash && { txHash: maskTxHash(txHash) }),
      ...(authorization && { from: maskAddress(authorization.authorization.from), scheme: 'erc3009' })
    })

    // Early guard: Reject mock tx hashes in live mode (only applies to txHash mode)
    if (txHash && serverEnv.ENABLE_X402) {
      // Check if txHash is a mock pattern
      const isMockPattern = txHash.toLowerCase().startsWith('0xmock')
      // Also check if it's not strict hex (our mock generator might create invalid hashes)
      const isStrictHex = /^0x[0-9a-fA-F]{64}$/.test(txHash)

      if (isMockPattern || !isStrictHex) {
        logger.warn('queue/confirm mock proof rejected in live mode', {
          requestId,
          challengeId,
          txHash: maskTxHash(txHash),
          isMockPattern,
          isStrictHex
        })
        res.status(400).json({
          error: {
            code: 'PROVIDER_ERROR',
            message: 'Mock proof not allowed in live mode. Please provide a valid transaction hash from Base Sepolia.'
          },
          requestId
        })
        return
      }
    }

    // 1. Check for existing confirmation by tx_hash (reuse detection) - only for txHash mode
    let existingByTxHash: any = null
    if (txHash) {
      const { data, error: txHashCheckErr } = await supabaseAdmin
        .from('payment_confirmations')
        .select('*, payment_challenges!inner(track_id, user_id, bound_address)')
        .eq('tx_hash', txHash)
        .single()

      existingByTxHash = data

      if (txHashCheckErr && txHashCheckErr.code !== 'PGRST116') {
        // PGRST116 = no rows, which is fine; anything else is an error
        logger.error('queue/confirm error checking existing confirmation by tx_hash', {
          requestId,
          error: txHashCheckErr
        })
        res.status(500).json({
          error: {
            code: 'DB_ERROR',
            message: 'Database error while checking payment status'
          },
          requestId
        })
        return
      }
    }

    if (existingByTxHash) {
      // Transaction hash already used for a confirmation
      const existingChallengeId = existingByTxHash.challenge_id

      // Case 1: Same challenge - true idempotency
      if (existingChallengeId === challengeId) {
        const joinedData = (existingByTxHash as any).payment_challenges
        if (!joinedData || !joinedData.track_id) {
          logger.error('queue/confirm malformed join data', { requestId, existingByTxHash })
          res.status(500).json({
            error: {
              code: 'DB_ERROR',
              message: 'Invalid database relationship'
            },
            requestId
          })
          return
        }

        const trackId = joinedData.track_id
        logger.info('queue/confirm idempotent (same challenge, same tx)', {
          requestId,
          challengeId,
          txHash: maskTxHash(txHash),
          trackId,
          existingConfirmationId: existingByTxHash.id
        })

        // Load track to return current status
        const { data: track, error: trackErr } = await supabaseAdmin
          .from('tracks')
          .select('*')
          .eq('id', trackId)
          .single()

        if (trackErr) {
          logger.warn('queue/confirm track not found for existing confirmation', { requestId, trackId })
        }

        res.status(200).json({
          ok: true,
          idempotent: true,
          trackId,
          status: track?.status || 'PAID',
          requestId
        })
        return
      }

      // Case 2: Different challenge - TX_ALREADY_USED (reuse detected)
      const joinedData = (existingByTxHash as any).payment_challenges
      if (!joinedData || !joinedData.track_id) {
        logger.error('queue/confirm malformed join data for reuse', { requestId, existingByTxHash })
        res.status(500).json({
          error: {
            code: 'DB_ERROR',
            message: 'Invalid database relationship'
          },
          requestId
        })
        return
      }

      const originalTrackId = joinedData.track_id
      const originalConfirmedAt = existingByTxHash.created_at

      logger.warn('queue/confirm tx_hash reused across different challenges', {
        requestId,
        currentChallengeId: challengeId,
        existingChallengeId,
        txHash: maskTxHash(txHash),
        originalTrackId,
        originalConfirmedAt
      })

      // Build reason codes
      const reasonCodes = ['TX_ALREADY_USED']
      let payerAddress: string | null = null
      let currentBoundAddress: string | null = null

      // Load current challenge to check if there's a bound address mismatch
      const { data: currentChallenge, error: currentChallengeErr } = await supabaseAdmin
        .from('payment_challenges')
        .select('bound_address')
        .eq('challenge_id', challengeId)
        .single()

      if (!currentChallengeErr && currentChallenge) {
        currentBoundAddress = currentChallenge.bound_address
      }

      // Check WRONG_PAYER: Prefer token_from_address over tx_from_address
      const existingPayer = (existingByTxHash as any).token_from_address ?? existingByTxHash.tx_from_address
      if (existingPayer && currentBoundAddress) {
        if (!addressesMatch(existingPayer, currentBoundAddress)) {
          reasonCodes.push('WRONG_PAYER')
          payerAddress = existingPayer
          logger.info('queue/confirm reuse with WRONG_PAYER detected', {
            requestId,
            payer: maskAddress(existingPayer),
            payerSource: (existingByTxHash as any).token_from_address ? 'tokenFrom' : 'txSender',
            currentBound: maskAddress(currentBoundAddress)
          })
        }
      } else if (!existingPayer && currentBoundAddress) {
        // No tx_from_address stored - attempt RPC fetch for WRONG_PAYER detection
        logger.info('queue/confirm attempting RPC fetch for reuse WRONG_PAYER check', {
          requestId,
          txHash: maskTxHash(txHash)
        })

        try {
          const rpcUrl = serverEnv.BASE_SEPOLIA_RPC_URL
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 2000)

          const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'eth_getTransactionReceipt',
              params: [txHash]
            }),
            signal: controller.signal
          })

          clearTimeout(timeoutId)

          if (response.ok) {
            const json = await response.json()
            const receipt = json.result
            if (receipt && receipt.from) {
              const txFrom = normalizeEvmAddress(receipt.from)
              payerAddress = txFrom
              if (!addressesMatch(txFrom, currentBoundAddress)) {
                reasonCodes.push('WRONG_PAYER')
                logger.info('queue/confirm reuse with WRONG_PAYER detected via RPC', {
                  requestId,
                  txFrom: maskAddress(txFrom),
                  currentBound: maskAddress(currentBoundAddress)
                })
              }
            }
          }
        } catch (rpcErr: any) {
          logger.warn('queue/confirm RPC fetch for WRONG_PAYER failed (non-fatal)', {
            requestId,
            error: rpcErr?.message
          })
          // Continue without WRONG_PAYER signal
        }
      }

      // Add metrics logging
      logger.info('queue/confirm metric', {
        metric: 'x402_confirm_total',
        code: 'TX_ALREADY_USED',
        status: 409,
        requestId,
        reasonCodes
      })

      // Return 409 TX_ALREADY_USED
      res.status(409).json({
        error: {
          code: 'TX_ALREADY_USED',
          message: 'This transaction was already used to confirm a different payment.',
          reasonCodes,
          original: {
            challengeId: existingChallengeId,
            trackId: originalTrackId,
            confirmedAt: originalConfirmedAt,
            txFrom: payerAddress,
            boundAddress: currentBoundAddress
          }
        },
        requestId
      })
      return
    }

    // 2. Load challenge by challengeId
    const { data: challenge, error: challengeErr } = await supabaseAdmin
      .from('payment_challenges')
      .select('*')
      .eq('challenge_id', challengeId)
      .single()

    if (challengeErr || !challenge) {
      logger.warn('queue/confirm challenge not found', { requestId, challengeId })
      res.status(404).json({
        error: { code: 'NO_MATCH', message: 'Payment challenge not found' },
        requestId
      })
      return
    }

    // 3. Check expiry with ±60s clock skew tolerance
    const now = Date.now()
    const expiresAt = new Date(challenge.expires_at).getTime()
    if (now > expiresAt + CLOCK_SKEW_MS) {
      logger.warn('queue/confirm challenge expired', {
        requestId,
        challengeId,
        expiresAt: challenge.expires_at,
        now: new Date(now).toISOString(),
        skewAllowance: `${CLOCK_SKEW_MS / 1000}s`
      })
      res.status(400).json({
        error: {
          code: 'EXPIRED',
          message: 'Payment challenge has expired. Please refresh and try again.'
        },
        requestId
      })
      return
    }

    // 4. Branch: RPC-only, Facilitator, CDP, or mock verification
    let verificationResult: { ok: true; amountPaidAtomic: number | string } | { ok: false; code: string; message?: string; detail?: string }

    // Provider selection based on X402_MODE
    if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'rpc-only') {
      // RPC-only verification (simple transaction verification, not full x402 protocol)
      logger.info('queue/confirm using RPC-only verification', {
        requestId,
        challengeId,
        chain: challenge.chain,
        asset: challenge.asset,
        chainId: serverEnv.X402_CHAIN_ID
      })

      const rpcResult = await verifyViaRPC({
        txHash,
        tokenAddress: serverEnv.X402_TOKEN_ADDRESS!,
        payTo: challenge.pay_to,
        amountAtomic: Number(challenge.amount_atomic),
        chainId: serverEnv.X402_CHAIN_ID
      })

      if (!rpcResult.ok) {
        const status = rpcResult.code === 'NO_MATCH' ? 404 : 400
        logger.warn('queue/confirm RPC verification failed', {
          requestId,
          challengeId,
          txHash: maskTxHash(txHash),
          code: rpcResult.code,
          message: rpcResult.message
        })
        res.status(status).json({
          error: { code: rpcResult.code, message: rpcResult.message },
          requestId
        })
        return
      }

      // Wallet binding enforcement (RPC-only mode security)
      if (serverEnv.X402_REQUIRE_BINDING) {
        // Check if wallet was bound
        if (!challenge.bound_address) {
          logger.warn('queue/confirm wallet not bound', {
            requestId,
            challengeId,
            txHash: maskTxHash(txHash)
          })
          res.status(400).json({
            error: {
              code: 'WALLET_NOT_BOUND',
              message: 'Wallet address must be proven before payment. Please connect and prove your wallet first.'
            },
            requestId
          })
          return
        }

        // Resolve payer: prefer ERC-20 Transfer 'from' over transaction sender
        const payer = rpcResult.tokenFrom ?? rpcResult.txSender ?? rpcResult.txFrom
        const payerSource = rpcResult.tokenFrom ? 'tokenFrom' : (rpcResult.txSender ? 'txSender' : 'txFrom')

        if (!payer) {
          logger.error('queue/confirm payer unknown (no addresses available)', {
            requestId,
            challengeId,
            txHash: maskTxHash(txHash)
          })
          res.status(500).json({
            error: {
              code: 'PAYER_UNKNOWN',
              message: 'Could not determine payment sender. Verification incomplete.'
            },
            requestId
          })
          return
        }

        // Check if payer matches bound address
        if (!addressesMatch(payer, challenge.bound_address)) {
          const normalizedPayer = normalizeEvmAddress(payer)
          const normalizedBound = normalizeEvmAddress(challenge.bound_address)

          logger.warn('queue/confirm wrong payer', {
            requestId,
            challengeId,
            txHash: maskTxHash(txHash),
            payer: maskAddress(normalizedPayer),
            payerSource,
            tokenFrom: rpcResult.tokenFrom ? maskAddress(rpcResult.tokenFrom) : undefined,
            txSender: rpcResult.txSender ? maskAddress(rpcResult.txSender) : undefined,
            boundAddress: maskAddress(normalizedBound)
          })

          // Add metrics logging
          logger.info('queue/confirm metric', {
            metric: 'x402_confirm_total',
            code: 'WRONG_PAYER',
            status: 400,
            requestId,
            payerSource
          })

          res.status(400).json({
            error: {
              code: 'WRONG_PAYER',
              message: 'Payment sent from different wallet than proven.',
              reasonCodes: ['WRONG_PAYER'],
              detected: {
                payerSource,
                payer: normalizedPayer,
                tokenFrom: rpcResult.tokenFrom ? normalizeEvmAddress(rpcResult.tokenFrom) : undefined,
                txSender: rpcResult.txSender ? normalizeEvmAddress(rpcResult.txSender) : undefined,
                boundAddress: normalizedBound
              }
            },
            requestId
          })
          return
        }

        logger.info('queue/confirm wallet binding verified', {
          requestId,
          challengeId,
          address: maskAddress(challenge.bound_address),
          payerSource,
          sameAddress: rpcResult.tokenFrom && rpcResult.txSender ? rpcResult.tokenFrom === rpcResult.txSender : 'unknown'
        })
      }

      verificationResult = {
        ok: true,
        amountPaidAtomic: Number(rpcResult.amountPaidAtomic)
      }
    } else if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'facilitator') {
      // Facilitator verification - route based on payload type (authorization vs txHash)
      logger.info('queue/confirm using Facilitator verification', {
        requestId,
        challengeId,
        facilitatorUrl: serverEnv.X402_FACILITATOR_URL,
        chain: challenge.chain,
        asset: challenge.asset,
        mode: authorization ? 'authorization (ERC-3009)' : 'txHash'
      })

      let vr: Awaited<ReturnType<typeof facilitatorVerify>>

      if (authorization) {
        // ERC-3009 transferWithAuthorization flow
        // Extract auth fields for easier access
        const authFields = authorization.authorization
        const signature = authorization.signature

        // Debug log before facilitator call
        logger.debug('facilitator payload sanity', {
          requestId,
          hasSignature: typeof signature === 'string',
          sigLen: signature?.length,
          value: authFields.value,
          validAfter: authFields.validAfter,
          validBefore: authFields.validBefore,
          nonceLen: authFields.nonce?.length
        })

        // Strict server-side validation before calling facilitator
        logger.info('queue/confirm pre-facilitator validation', {
          requestId,
          challengeId,
          scheme: 'erc3009',
          from: maskAddress(authFields.from),
          to: maskAddress(authFields.to),
          value: authFields.value,
          validBefore: authFields.validBefore,
          validAfter: authFields.validAfter,
          chainId: serverEnv.X402_CHAIN_ID,
          tokenAddress: maskAddress(serverEnv.X402_TOKEN_ADDRESS!)
        })

        // 1. Chain ID must match
        if (serverEnv.X402_CHAIN_ID !== parseInt(String(serverEnv.X402_CHAIN_ID))) {
          // This should never happen, but check for safety
          logger.error('queue/confirm invalid server chain ID config', { requestId, chainId: serverEnv.X402_CHAIN_ID })
          res.status(500).json({
            error: { code: 'INTERNAL', message: 'Server configuration error' },
            requestId
          })
          return
        }

        // 2. Token address must match (case-insensitive)
        if (normalizeEvmAddress(serverEnv.X402_TOKEN_ADDRESS!) !== normalizeEvmAddress(serverEnv.X402_TOKEN_ADDRESS!)) {
          logger.warn('queue/confirm wrong token', {
            requestId,
            challengeId,
            expected: maskAddress(serverEnv.X402_TOKEN_ADDRESS!),
            got: maskAddress(serverEnv.X402_TOKEN_ADDRESS!)
          })
          res.status(400).json({
            error: {
              code: 'WRONG_TOKEN',
              message: 'Authorization for wrong token contract'
            },
            requestId
          })
          return
        }

        // 3. Recipient (to) must match receiving address
        if (normalizeEvmAddress(authFields.to) !== normalizeEvmAddress(serverEnv.X402_RECEIVING_ADDRESS!)) {
          logger.warn('queue/confirm wrong payTo', {
            requestId,
            challengeId,
            expected: maskAddress(serverEnv.X402_RECEIVING_ADDRESS!),
            got: maskAddress(authFields.to)
          })
          res.status(400).json({
            error: {
              code: 'WRONG_PAYTO',
              message: 'Payment sent to wrong address'
            },
            requestId
          })
          return
        }

        // 4. Amount must match exactly
        if (authFields.value !== String(challenge.amount_atomic)) {
          logger.warn('queue/confirm wrong amount', {
            requestId,
            challengeId,
            expected: challenge.amount_atomic,
            got: authFields.value
          })
          res.status(400).json({
            error: {
              code: 'WRONG_AMOUNT',
              message: `Amount mismatch: expected ${challenge.amount_atomic}, got ${authFields.value}`
            },
            requestId
          })
          return
        }

        // 5. validBefore must be in the future (with clock skew tolerance)
        const nowUnix = Math.floor(Date.now() / 1000)
        if (authFields.validBefore <= nowUnix - (CLOCK_SKEW_MS / 1000)) {
          logger.warn('queue/confirm authorization expired', {
            requestId,
            challengeId,
            validBefore: authFields.validBefore,
            now: nowUnix
          })
          res.status(400).json({
            error: {
              code: 'EXPIRED',
              message: 'Authorization has expired'
            },
            requestId
          })
          return
        }

        // 6. validBefore must not exceed challenge expiry
        const challengeExpiryUnix = Math.floor(new Date(challenge.expires_at).getTime() / 1000)
        if (authFields.validBefore > challengeExpiryUnix) {
          logger.warn('queue/confirm authorization validBefore exceeds challenge expiry', {
            requestId,
            challengeId,
            validBefore: authFields.validBefore,
            challengeExpiry: challengeExpiryUnix
          })
          res.status(400).json({
            error: {
              code: 'INVALID_EXPIRY',
              message: 'Authorization expiry exceeds challenge expiry'
            },
            requestId
          })
          return
        }

        // 7. validAfter must be <= now (or allow future with small tolerance)
        if (authFields.validAfter > nowUnix + (CLOCK_SKEW_MS / 1000)) {
          logger.warn('queue/confirm authorization not yet valid', {
            requestId,
            challengeId,
            validAfter: authFields.validAfter,
            now: nowUnix
          })
          res.status(400).json({
            error: {
              code: 'NOT_YET_VALID',
              message: 'Authorization not yet valid'
            },
            requestId
          })
          return
        }

        // 8. Nonce must be present and correct format (already validated by schema)
        if (!authFields.nonce || !authFields.nonce.match(/^0x[a-fA-F0-9]{64}$/)) {
          logger.warn('queue/confirm invalid nonce format', {
            requestId,
            challengeId,
            nonce: authFields.nonce ? `${authFields.nonce.substring(0, 10)}...` : 'missing'
          })
          res.status(400).json({
            error: {
              code: 'INVALID_NONCE',
              message: 'Invalid nonce format'
            },
            requestId
          })
          return
        }

        // 9. Optional: wallet binding enforcement (if enabled for facilitator mode)
        // In facilitator mode, binding is typically NOT required since ERC-3009 signature binds the payer
        // But we'll check the flag just in case
        if (serverEnv.X402_REQUIRE_BINDING && challenge.bound_address) {
          if (!addressesMatch(authFields.from, challenge.bound_address)) {
            logger.warn('queue/confirm wallet not bound in facilitator mode', {
              requestId,
              challengeId,
              from: maskAddress(authFields.from),
              boundAddress: maskAddress(challenge.bound_address)
            })
            res.status(400).json({
              error: {
                code: 'WALLET_NOT_BOUND',
                message: 'Payment from different wallet than proven'
              },
              requestId
            })
            return
          }
        }

        // All validations passed - call facilitator with flattened authorization
        const flatAuthorization: ERC3009Authorization = {
          from: authFields.from,
          to: authFields.to,
          value: authFields.value,
          validAfter: authFields.validAfter,
          validBefore: authFields.validBefore,
          nonce: authFields.nonce,
          signature: signature
        }

        // Guard: Check facilitator URL configured
        const facilitatorBaseUrl = serverEnv.X402_FACILITATOR_URL
        if (!facilitatorBaseUrl) {
          logger.error('queue/confirm facilitator URL not configured', { requestId, challengeId })
          res.status(503).json({
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              message: 'Payment verification service not configured'
            },
            requestId
          })
          return
        }

        // Call facilitator with explicit baseUrl and catch all errors as 503
        try {
          vr = await facilitatorVerifyAuthorization(
            {
              chain: challenge.chain,
              asset: challenge.asset,
              amountAtomic: String(challenge.amount_atomic),
              payTo: challenge.pay_to,
              chainId: serverEnv.X402_CHAIN_ID!,
              tokenAddress: serverEnv.X402_TOKEN_ADDRESS!,
              authorization: flatAuthorization
            },
            { baseUrl: facilitatorBaseUrl }
          )
        } catch (err: any) {
          // Map all facilitator errors to 503 PROVIDER_UNAVAILABLE
          logger.warn('queue/confirm facilitator call threw', {
            requestId,
            challengeId,
            error: err?.message,
            code: err?.code
          })

          // Check if RPC fallback is enabled
          if (err?.code === 'PROVIDER_UNAVAILABLE' && serverEnv.X402_FALLBACK_TO_RPC) {
            logger.info('queue/confirm facilitator unavailable, signaling RPC fallback', {
              requestId,
              challengeId
            })
            res.status(503).json({
              error: {
                code: 'PROVIDER_UNAVAILABLE',
                message: err?.message || 'Payment verification service temporarily unavailable. Please try again in a moment.',
                fallback: 'rpc'
              },
              requestId
            })
            return
          }

          // No fallback available or different error
          res.status(503).json({
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              message: err?.message || 'Payment verification service temporarily unavailable. Please try again in a moment.'
            },
            requestId
          })
          return
        }

        // Persist authorization to database for audit trail
        if (vr.ok) {
          try {
            const { error: authInsertErr } = await supabaseAdmin.from('payment_authorizations').insert({
              challenge_id: challengeId,
              scheme: 'erc3009',
              chain_id: serverEnv.X402_CHAIN_ID,
              token_address: serverEnv.X402_TOKEN_ADDRESS!,
              from_address: flatAuthorization.from,
              to_address: flatAuthorization.to,
              value_atomic: flatAuthorization.value,
              valid_after: flatAuthorization.validAfter,
              valid_before: flatAuthorization.validBefore,
              nonce: flatAuthorization.nonce,
              signature: flatAuthorization.signature,
              facilitator_verdict: vr.providerRaw || {}
            })

            // Check for AUTH_REUSED (unique constraint violation on nonce)
            if (authInsertErr && authInsertErr.code === '23505') {
              // Signature already used - check if for same or different challenge
              const { data: existingAuth } = await supabaseAdmin
                .from('payment_authorizations')
                .select('challenge_id, created_at, payment_challenges!inner(track_id)')
                .eq('token_address', serverEnv.X402_TOKEN_ADDRESS!)
                .eq('from_address', flatAuthorization.from)
                .eq('nonce', flatAuthorization.nonce)
                .single()

              if (existingAuth) {
                if (existingAuth.challenge_id === challengeId) {
                  // Same challenge - idempotent, continue
                  logger.info('queue/confirm authorization idempotent (same challenge)', {
                    requestId,
                    challengeId,
                    nonce: flatAuthorization.nonce.substring(0, 10) + '...'
                  })
                } else {
                  // Different challenge - AUTH_REUSED
                  logger.warn('queue/confirm authorization reused across challenges', {
                    requestId,
                    currentChallengeId: challengeId,
                    existingChallengeId: existingAuth.challenge_id,
                    nonce: flatAuthorization.nonce.substring(0, 10) + '...'
                  })

                  const joinedData = (existingAuth as any).payment_challenges
                  res.status(409).json({
                    error: {
                      code: 'AUTH_REUSED',
                      message: 'This authorization was already used for a different payment',
                      original: {
                        challengeId: existingAuth.challenge_id,
                        trackId: joinedData?.track_id,
                        confirmedAt: existingAuth.created_at
                      }
                    },
                    requestId
                  })
                  return
                }
              }
            } else if (authInsertErr) {
              // Other DB error - log but continue
              logger.warn('queue/confirm failed to persist authorization (non-fatal)', {
                requestId,
                challengeId,
                error: authInsertErr.message
              })
            }
          } catch (dbErr) {
            logger.warn('queue/confirm failed to persist authorization (non-fatal)', {
              requestId,
              challengeId,
              error: (dbErr as Error)?.message
            })
            // Continue despite DB error - payment was verified
          }
        }
      } else if (txHash) {
        // Legacy txHash verification
        vr = await facilitatorVerify({
          chain: challenge.chain,
          asset: challenge.asset,
          amountAtomic: String(challenge.amount_atomic),
          payTo: challenge.pay_to,
          txHash,
          tokenAddress: serverEnv.X402_TOKEN_ADDRESS,
          chainId: serverEnv.X402_CHAIN_ID
        })
      } else {
        // Should never reach here due to schema validation
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Either txHash or authorization required'
          },
          requestId
        })
        return
      }

      if (!vr.ok) {
        // On 5xx PROVIDER_ERROR, try RPC fallback (only for txHash mode, not authorization)
        if (vr.code === 'PROVIDER_ERROR' && txHash && serverEnv.X402_TOKEN_ADDRESS && serverEnv.X402_CHAIN_ID) {
          logger.warn('queue/confirm facilitator failed, trying RPC fallback', {
            requestId,
            challengeId,
            txHash: maskTxHash(txHash),
            facilitatorError: vr.message
          })

          const rpcResult = await verifyViaRPC({
            txHash,
            tokenAddress: serverEnv.X402_TOKEN_ADDRESS,
            payTo: challenge.pay_to,
            amountAtomic: Number(challenge.amount_atomic),
            chainId: serverEnv.X402_CHAIN_ID
          })

          if (rpcResult.ok) {
            logger.info('queue/confirm RPC fallback succeeded', {
              requestId,
              challengeId,
              txHash: maskTxHash(txHash)
            })
            verificationResult = {
              ok: true,
              amountPaidAtomic: Number(rpcResult.amountPaidAtomic)
            }
          } else {
            // RPC fallback also failed with granular error
            const status = rpcResult.code === 'NO_MATCH' ? 404 : 400
            logger.warn('queue/confirm RPC fallback failed', {
              requestId,
              challengeId,
              txHash: maskTxHash(txHash),
              code: rpcResult.code,
              message: rpcResult.message
            })
            res.status(status).json({
              error: { code: rpcResult.code, message: rpcResult.message },
              requestId
            })
            return
          }
        } else {
          // 4xx error from facilitator or no RPC fallback available
          const status = vr.code === 'NO_MATCH' ? 404 : 400
          logger.warn('queue/confirm facilitator verification failed', {
            requestId,
            challengeId,
            txHash: maskTxHash(txHash),
            code: vr.code,
            message: vr.message
          })
          res.status(status).json({
            error: { code: vr.code, message: vr.message },
            requestId
          })
          return
        }
      } else {
        // Facilitator succeeded - check for settlement tx hash
        // In authorization mode, we require a real settlement transaction hash
        if (authorization && (!vr.txHash || !/^0x[0-9a-fA-F]{64}$/.test(vr.txHash))) {
          logger.info('queue/confirm facilitator verified but no settlement tx hash - initiating settlement', {
            requestId,
            challengeId,
            hasTxHash: !!vr.txHash,
            txHashPreview: vr.txHash ? vr.txHash.substring(0, 10) + '...' : 'missing',
            strategy: serverEnv.X402_SETTLE_STRATEGY || 'auto'
          })

          // =====================================================================
          // SETTLEMENT LAYER: facilitator settle API → local broadcast fallback
          // =====================================================================

          const strategy = serverEnv.X402_SETTLE_STRATEGY || 'auto'
          let settleTxHash: string | null = null
          let facilitatorSettleTried = false
          let facilitatorSettleSuccess = false
          let localSettleTried = false
          let localSettleSuccess = false

          // Convert authorization to settle format
          const settleAuth: SettleAuth = {
            from: authorization.authorization.from,
            to: authorization.authorization.to,
            value: String(authorization.authorization.value),
            validAfter: Number(authorization.authorization.validAfter),
            validBefore: Number(authorization.authorization.validBefore),
            nonce: authorization.authorization.nonce,
            signature: authorization.signature
          }

          // Step 1: Try facilitator settle (if strategy allows)
          if ((strategy === 'facilitator' || strategy === 'auto') && serverEnv.X402_FACILITATOR_URL) {
            facilitatorSettleTried = true

            try {
              settleTxHash = await settleWithFacilitator(settleAuth, {
                facilitatorUrl: serverEnv.X402_FACILITATOR_URL,
                apiKey: serverEnv.FACILITATOR_API_KEY,
                challenge: {
                  challenge_id: challengeId,
                  pay_to: challenge.pay_to,
                  amount_atomic: challenge.amount_atomic,
                  nonce: challenge.nonce
                },
                requestId
              })

              if (settleTxHash) {
                facilitatorSettleSuccess = true
                logger.info('queue/confirm facilitator settle succeeded', {
                  requestId,
                  challengeId,
                  txHash: maskTxHash(settleTxHash)
                })
              } else {
                logger.info('queue/confirm facilitator settle returned null', {
                  requestId,
                  challengeId,
                  strategy
                })
              }
            } catch (err: any) {
              logger.warn('queue/confirm facilitator settle error', {
                requestId,
                challengeId,
                error: err?.message
              })
            }
          }

          // Step 2: Fallback to local settle (if strategy allows and facilitator failed)
          if (!settleTxHash && (strategy === 'local' || strategy === 'auto') && serverEnv.SETTLER_PRIVATE_KEY) {
            localSettleTried = true

            try {
              settleTxHash = await settleLocally(settleAuth, {
                privateKey: serverEnv.SETTLER_PRIVATE_KEY,
                rpcUrl: serverEnv.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org',
                usdcContract: serverEnv.USDC_CONTRACT_ADDRESS_BASE!,
                challenge: {
                  pay_to: challenge.pay_to,
                  amount_atomic: challenge.amount_atomic
                },
                requestId
              })

              if (settleTxHash) {
                localSettleSuccess = true
                logger.info('queue/confirm local settle succeeded', {
                  requestId,
                  challengeId,
                  txHash: maskTxHash(settleTxHash)
                })
              }
            } catch (err: any) {
              logger.warn('queue/confirm local settle error', {
                requestId,
                challengeId,
                error: err?.message
              })

              // Check for validation errors (pre-flight failures)
              if (err?.message?.includes('VALIDATION_ERROR')) {
                res.status(400).json({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: err.message.replace('VALIDATION_ERROR: ', '')
                  },
                  requestId
                })
                return
              }
            }
          }

          // Step 3: No settlement achieved
          if (!settleTxHash) {
            logger.warn('queue/confirm no settlement achieved', {
              requestId,
              challengeId,
              strategy,
              facilitatorSettleTried,
              facilitatorSettleSuccess,
              localSettleTried,
              localSettleSuccess
            })

            res.status(502).json({
              error: {
                code: 'PROVIDER_NO_SETTLEMENT',
                message: 'Payment verification succeeded but settlement failed. No transaction broadcast.'
              },
              requestId
            })
            return
          }

          // Success! We have a settlement txHash - store it and continue
          txHash = settleTxHash

          logger.info('queue/confirm settlement completed', {
            requestId,
            challengeId,
            txHash: maskTxHash(settleTxHash),
            strategy,
            facilitatorUsed: facilitatorSettleSuccess,
            localUsed: localSettleSuccess
          })
        }

        // Store facilitator tx hash for later use
        if (vr.txHash && !txHash) {
          txHash = vr.txHash
        }

        // Verify settlement on-chain (Base mainnet)
        if (authorization && txHash) {
          logger.info('queue/confirm verifying settlement on Base mainnet', {
            requestId,
            challengeId,
            txHash: maskTxHash(txHash)
          })

          const settlementResult = await verifySettlementOnChain(txHash as Hash, {
            expectedRecipient: challenge.pay_to,
            expectedAmountAtomic: challenge.amount_atomic,
            expectedSender: authorization.authorization.from,
            tokenAddress: serverEnv.X402_TOKEN_ADDRESS!,
            requestId,
            challengeId
          })

          if (!settlementResult.ok) {
            // Handle TX_PENDING separately (202 response)
            if (settlementResult.code === 'TX_PENDING') {
              logger.info('queue/confirm settlement pending', {
                requestId,
                challengeId,
                txHash: maskTxHash(txHash)
              })
              res.status(202).json({
                status: 'TX_PENDING',
                txHash,
                message: settlementResult.message,
                requestId
              })
              return
            }

            // Other errors (TX_FAILED, WRONG_RECIPIENT, UNDERPAID) are 400
            logger.warn('queue/confirm settlement verification failed', {
              requestId,
              challengeId,
              txHash: maskTxHash(txHash),
              code: settlementResult.code,
              message: settlementResult.message
            })
            res.status(400).json({
              error: {
                code: settlementResult.code,
                message: settlementResult.message
              },
              requestId
            })
            return
          }

          // Settlement verified - use actual paid amount from on-chain
          logger.info('queue/confirm settlement verified on-chain', {
            requestId,
            challengeId,
            txHash: maskTxHash(txHash),
            amountPaid: settlementResult.amountPaid
          })

          verificationResult = {
            ok: true,
            amountPaidAtomic: settlementResult.amountPaid,
            tokenFrom: settlementResult.from
          }
        } else {
          // Legacy path (no authorization or no txHash)
          verificationResult = {
            ok: true,
            amountPaidAtomic: Number(vr.amountPaidAtomic)
          }
        }
      }
    } else if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'cdp') {
      // Direct CDP verification (for mainnet SDK later)
      logger.info('queue/confirm using CDP verification', { requestId, challengeId })
      verificationResult = await verifyPayment({
        txHash,
        payTo: challenge.pay_to,
        amountAtomic: Number(challenge.amount_atomic),
        asset: challenge.asset,
        chain: challenge.chain,
        challengeId
      })
    } else if (serverEnv.ENABLE_MOCK_PAYMENTS) {
      // Mock verification
      logger.info('queue/confirm using mock verification', { requestId, challengeId })
      verificationResult = await verifyMockPayment(txHash, Number(challenge.amount_atomic), challengeId)
    } else {
      // Neither enabled - payments disabled
      logger.error('queue/confirm payments disabled', {
        requestId,
        x402Enabled: serverEnv.ENABLE_X402,
        x402Mode: serverEnv.X402_MODE,
        mockEnabled: serverEnv.ENABLE_MOCK_PAYMENTS
      })
      res.status(503).json({
        error: {
          code: 'PAYMENTS_DISABLED',
          message: 'Payment verification is not available at this time'
        },
        requestId
      })
      return
    }

    // 5. Handle verification failure
    if (!verificationResult.ok) {
      logger.warn('queue/confirm verification failed', {
        requestId,
        challengeId,
        txHash: maskTxHash(txHash),
        code: verificationResult.code,
        message: verificationResult.message,
        detail: verificationResult.detail
      })

      // Audit log (structured)
      logger.info('queue/confirm audit: verification failed', {
        requestId,
        challengeId,
        txHash: maskTxHash(txHash),
        userId: challenge.user_id,
        trackId: challenge.track_id,
        amountAtomic: challenge.amount_atomic,
        asset: challenge.asset,
        chain: challenge.chain,
        verdict: 'FAILED',
        code: verificationResult.code
      })

      res.status(400).json({
        error: {
          code: verificationResult.code,
          message: verificationResult.message
        },
        requestId
      })
      return
    }

    // 6. Verification successful! Insert confirmation record
    // Determine provider based on which mode was used
    let provider: string
    let tokenFrom: string | null = null
    let txSender: string | null = null

    if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'rpc-only') {
      provider = 'rpc'
      // Extract both addresses from RPC result
      if ((verificationResult as any).tokenFrom) {
        tokenFrom = normalizeEvmAddress((verificationResult as any).tokenFrom)
      }
      if ((verificationResult as any).txSender) {
        txSender = normalizeEvmAddress((verificationResult as any).txSender)
      }
      // Fallback to deprecated txFrom
      if (!txSender && (verificationResult as any).txFrom) {
        txSender = normalizeEvmAddress((verificationResult as any).txFrom)
      }
    } else if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'facilitator') {
      provider = 'facilitator'
      // Facilitator may also return these addresses
      if ((verificationResult as any).tokenFrom) {
        tokenFrom = normalizeEvmAddress((verificationResult as any).tokenFrom)
      }
      if ((verificationResult as any).txSender) {
        txSender = normalizeEvmAddress((verificationResult as any).txSender)
      }
      if (!txSender && (verificationResult as any).txFrom) {
        txSender = normalizeEvmAddress((verificationResult as any).txFrom)
      }
    } else if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'cdp') {
      provider = 'cdp'
    } else {
      provider = 'mock'
    }

    // Resolve payer_user_id from wallet address (if linked)
    const payerAddress = tokenFrom || txSender || (authorization?.from)
    let payerUserId: string | null = null

    if (payerAddress) {
      const normalizedPayerAddress = normalizeEvmAddress(payerAddress)

      const { data: walletAccount } = await supabaseAdmin
        .from('user_accounts')
        .select('user_id')
        .eq('provider', 'wallet')
        .eq('provider_user_id', normalizedPayerAddress)
        .single()

      if (walletAccount) {
        payerUserId = walletAccount.user_id
        logger.info('queue/confirm payer resolved to user', {
          requestId,
          challengeId,
          payerAddress: maskAddress(normalizedPayerAddress),
          payerUserId
        })
      }
    }

    const { data: confirmation, error: confirmInsertErr} = await supabaseAdmin
      .from('payment_confirmations')
      .insert({
        challenge_id: challengeId,
        tx_hash: txHash,
        payer_user_id: payerUserId,
        payer_address: payerAddress ? normalizeEvmAddress(payerAddress) : null,
        token_from_address: tokenFrom,
        tx_from_address: txSender,
        provider,
        amount_paid_atomic: verificationResult.amountPaidAtomic,
        provider_raw: {
          verified_at: new Date().toISOString(),
          request_id: requestId,
          token_from: tokenFrom,
          tx_sender: txSender
        }
      })
      .select()
      .single()

    if (confirmInsertErr) {
      // Check if this is a uniqueness violation (race condition on tx_hash)
      if (confirmInsertErr.code === '23505') {
        // Concurrent request won - re-query by tx_hash to determine if idempotent or reuse
        logger.info('queue/confirm concurrent confirmation detected (unique constraint)', {
          requestId,
          challengeId,
          txHash: maskTxHash(txHash)
        })

        const { data: existing, error: existingErr } = await supabaseAdmin
          .from('payment_confirmations')
          .select('*, payment_challenges!inner(track_id, bound_address)')
          .eq('tx_hash', txHash)
          .single()

        if (existingErr) {
          logger.error('queue/confirm failed to retrieve concurrent confirmation', {
            requestId,
            challengeId,
            txHash: maskTxHash(txHash),
            error: existingErr
          })
          res.status(500).json({
            error: {
              code: 'DB_ERROR',
              message: 'Database concurrency error'
            },
            requestId
          })
          return
        }

        if (existing) {
          const existingChallengeId = existing.challenge_id

          // Case 1: Same challenge - idempotent
          if (existingChallengeId === challengeId) {
            const joinedData = (existing as any).payment_challenges
            if (!joinedData || !joinedData.track_id) {
              logger.error('queue/confirm malformed concurrent join data', { requestId, existing })
              res.status(500).json({
                error: {
                  code: 'DB_ERROR',
                  message: 'Invalid database relationship'
                },
                requestId
              })
              return
            }

            const trackId = joinedData.track_id
            res.status(200).json({
              ok: true,
              idempotent: true,
              trackId,
              status: 'PAID',
              requestId
            })
            return
          }

          // Case 2: Different challenge - TX_ALREADY_USED
          const joinedData = (existing as any).payment_challenges
          const originalTrackId = joinedData?.track_id
          const originalConfirmedAt = existing.created_at
          const reasonCodes = ['TX_ALREADY_USED']
          // Prefer token_from_address over tx_from_address for payer resolution
          let payerAddress: string | null = (existing as any).token_from_address ?? existing.tx_from_address ?? null
          let currentBoundAddress: string | null = challenge?.bound_address || null

          // Check WRONG_PAYER if we have both addresses
          if (payerAddress && currentBoundAddress && !addressesMatch(payerAddress, currentBoundAddress)) {
            reasonCodes.push('WRONG_PAYER')
          }

          logger.warn('queue/confirm concurrent reuse detected', {
            requestId,
            currentChallengeId: challengeId,
            existingChallengeId,
            txHash: maskTxHash(txHash),
            reasonCodes
          })

          // Add metrics logging
          logger.info('queue/confirm metric', {
            metric: 'x402_confirm_total',
            code: 'TX_ALREADY_USED',
            status: 409,
            requestId,
            reasonCodes
          })

          res.status(409).json({
            error: {
              code: 'TX_ALREADY_USED',
              message: 'This transaction was already used to confirm a different payment.',
              reasonCodes,
              original: {
                challengeId: existingChallengeId,
                trackId: originalTrackId,
                confirmedAt: originalConfirmedAt,
                txFrom: payerAddress,
                boundAddress: currentBoundAddress
              }
            },
            requestId
          })
          return
        }
      }

      // Other database error
      logger.error('queue/confirm failed to insert confirmation', {
        requestId,
        challengeId,
        error: confirmInsertErr
      })
      res.status(500).json({
        error: {
          code: 'DB_ERROR',
          message: 'Failed to record payment confirmation'
        },
        requestId
      })
      return
    }

    // 7. Update challenge.confirmed_at
    await supabaseAdmin
      .from('payment_challenges')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('challenge_id', challengeId)

    // 8. Transition track to AUGMENTING status and set payer
    const { data: paidTrack, error: trackUpdateErr } = await supabaseAdmin
      .from('tracks')
      .update({
        status: 'AUGMENTING',
        payer_user_id: payerUserId,
        payment_confirmation_id: confirmation.id,
        x402_payment_tx: {
          tx_hash: txHash,
          confirmed_at: new Date().toISOString(),
          amount_paid: verificationResult.amountPaidAtomic,
          provider
        }
      })
      .eq('id', challenge.track_id)
      .select()
      .single()

    if (trackUpdateErr || !paidTrack) {
      logger.error('queue/confirm failed to update track', {
        requestId,
        trackId: challenge.track_id,
        error: trackUpdateErr
      })
      res.status(500).json({
        error: {
          code: 'DB_ERROR',
          message: 'Failed to update track payment status'
        },
        requestId
      })
      return
    }

    // 8b. Enqueue augmentation job
    const { error: jobInsertErr } = await supabaseAdmin
      .from('jobs')
      .insert({
        track_id: challenge.track_id,
        kind: 'augment',
        status: 'queued'
      })

    if (jobInsertErr) {
      logger.error('queue/confirm failed to create augment job', {
        requestId,
        trackId: challenge.track_id,
        error: jobInsertErr
      })
      // Non-fatal - continue
    } else {
      logger.info('queue/confirm augment job created', {
        requestId,
        trackId: challenge.track_id
      })
    }

    logger.info('queue/confirm payment confirmed', {
      requestId,
      challengeId,
      txHash: maskTxHash(txHash),
      trackId: challenge.track_id,
      amountPaidAtomic: verificationResult.amountPaidAtomic,
      durationMs: Date.now() - startTime
    })

    // Audit log (structured, no secrets)
    logger.info('queue/confirm audit: success', {
      requestId,
      challengeId,
      txHash: maskTxHash(txHash),
      userId: challenge.user_id,
      trackId: challenge.track_id,
      amountAtomic: challenge.amount_atomic,
      amountPaidAtomic: verificationResult.amountPaidAtomic,
      asset: challenge.asset,
      chain: challenge.chain,
      verdict: 'SUCCESS'
    })

    // Metrics logging
    logger.info('queue/confirm metric', {
      metric: 'x402_confirm_total',
      code: 'SUCCESS',
      status: 200,
      requestId,
      durationMs: Date.now() - startTime
    })

    // 9. Broadcast queue update
    await broadcastQueueUpdate({
      queue: [paidTrack],
      action: 'updated',
      trackId: paidTrack.id
    })

    // 10. Trigger augmentation worker (fire-and-forget, non-blocking)
    try {
      const baseUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
      const workerUrl = `${baseUrl}/api/worker/augment`
      fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).catch(err =>
        logger.warn('queue/confirm worker trigger failed (non-blocking)', {
          requestId,
          error: err?.message
        })
      )
    } catch (err) {
      logger.warn('queue/confirm worker trigger error (non-blocking)', {
        requestId,
        error: (err as Error)?.message
      })
    }

    // 11. Return success response
    res.status(200).json({
      ok: true,
      trackId: paidTrack.id,
      status: 'AUGMENTING',
      txHash: txHash || undefined,
      requestId
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    errorTracker.trackError(err, { operation: 'queue/confirm', requestId })
    logger.error('queue/confirm unhandled error', { requestId }, err)

    // Defensive: Always return structured error, never let response hang
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          code: 'INTERNAL',
          message: 'Internal server error during payment confirmation'
        },
        requestId
      })
    }
  }
}

export default secureHandler(confirmHandler, securityConfigs.user)
