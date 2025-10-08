// api/queue/confirm.ts
// Verify x402 payment and transition track from PENDING_PAYMENT to PAID

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z, ZodError } from 'zod'
import { supabaseAdmin } from '../_shared/supabase.js'
import { verifyPayment } from '../_shared/payments/x402-cdp.js'
import { facilitatorVerify } from '../_shared/payments/x402-facilitator.js'
import { verifyViaRPC } from '../_shared/payments/x402-rpc.js'
import { serverEnv } from '../../src/config/env.server.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { errorTracker } from '../../src/lib/error-tracking.js'
import { broadcastQueueUpdate } from '../../src/server/realtime.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import { maskTxHash, maskAddress } from '../../src/lib/crypto-utils.js'
import { normalizeEvmAddress, addressesMatch } from '../../src/lib/binding-utils.js'

// Request validation schema
const confirmRequestSchema = z.object({
  challengeId: z.string().uuid('Invalid challenge ID format'),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash format')
})

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
    let txHash: string

    try {
      const parsed = confirmRequestSchema.parse(req.body)
      challengeId = parsed.challengeId
      txHash = parsed.txHash
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

    logger.info('queue/confirm processing', { requestId, challengeId, txHash: maskTxHash(txHash) })

    // Early guard: Reject mock tx hashes in live mode
    if (serverEnv.ENABLE_X402) {
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

    // 1. Check for existing confirmation (idempotency by challengeId OR tx_hash)
    const { data: existingConfirmation, error: confirmCheckErr } = await supabaseAdmin
      .from('payment_confirmations')
      .select('*, payment_challenges!inner(track_id, user_id)')
      .or(`challenge_id.eq.${challengeId},tx_hash.eq.${txHash}`)
      .single()

    if (confirmCheckErr && confirmCheckErr.code !== 'PGRST116') {
      // PGRST116 = no rows, which is fine; anything else is an error
      logger.error('queue/confirm error checking existing confirmation', { requestId, error: confirmCheckErr })
      res.status(500).json({
        error: {
          code: 'DB_ERROR',
          message: 'Database error while checking payment status'
        },
        requestId
      })
      return
    }

    if (existingConfirmation) {
      // Defensive: Validate joined data structure exists
      const joinedData = (existingConfirmation as any).payment_challenges
      if (!joinedData || !joinedData.track_id) {
        logger.error('queue/confirm malformed join data', { requestId, existingConfirmation })
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
      logger.info('queue/confirm idempotent (already confirmed)', {
        requestId,
        challengeId,
        txHash: maskTxHash(txHash),
        trackId,
        existingConfirmationId: existingConfirmation.id
      })

      // Load track to return current status (defensive: handle missing track)
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
        trackId,
        status: track?.status || 'PAID',
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

        // Check if transaction sender matches bound address
        if (rpcResult.txFrom) {
          if (!addressesMatch(rpcResult.txFrom, challenge.bound_address)) {
            const normalizedTxFrom = normalizeEvmAddress(rpcResult.txFrom)
            const normalizedBound = normalizeEvmAddress(challenge.bound_address)

            logger.warn('queue/confirm wrong payer', {
              requestId,
              challengeId,
              txHash: maskTxHash(txHash),
              txFrom: maskAddress(normalizedTxFrom),
              boundAddress: maskAddress(normalizedBound)
            })

            res.status(400).json({
              error: {
                code: 'WRONG_PAYER',
                message: 'Payment sent from different wallet than proven. Please rebind your wallet or pay from the correct address.',
                detail: `Transaction from ${maskAddress(normalizedTxFrom)}, expected ${maskAddress(normalizedBound)}`
              },
              requestId
            })
            return
          }

          logger.info('queue/confirm wallet binding verified', {
            requestId,
            challengeId,
            address: maskAddress(challenge.bound_address)
          })
        } else {
          // RPC didn't return txFrom - log warning but allow (defensive)
          logger.warn('queue/confirm RPC result missing txFrom', {
            requestId,
            challengeId,
            txHash: maskTxHash(txHash),
            note: 'Binding check skipped due to missing sender address'
          })
        }
      }

      verificationResult = {
        ok: true,
        amountPaidAtomic: Number(rpcResult.amountPaidAtomic)
      }
    } else if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'facilitator') {
      // Facilitator verification (x402.org REST API for testnet)
      logger.info('queue/confirm using Facilitator verification', {
        requestId,
        challengeId,
        facilitatorUrl: serverEnv.X402_FACILITATOR_URL,
        chain: challenge.chain,
        asset: challenge.asset
      })

      const vr = await facilitatorVerify({
        chain: challenge.chain,
        asset: challenge.asset,
        amountAtomic: String(challenge.amount_atomic),
        payTo: challenge.pay_to,
        txHash,
        tokenAddress: serverEnv.X402_TOKEN_ADDRESS,
        chainId: serverEnv.X402_CHAIN_ID
      })

      if (!vr.ok) {
        // On 5xx PROVIDER_ERROR, try RPC fallback
        if (vr.code === 'PROVIDER_ERROR' && serverEnv.X402_TOKEN_ADDRESS && serverEnv.X402_CHAIN_ID) {
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
        // Facilitator succeeded
        verificationResult = {
          ok: true,
          amountPaidAtomic: Number(vr.amountPaidAtomic)
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
    if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'rpc-only') {
      provider = 'rpc'
    } else if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'facilitator') {
      provider = 'facilitator'
    } else if (serverEnv.ENABLE_X402 && serverEnv.X402_MODE === 'cdp') {
      provider = 'cdp'
    } else {
      provider = 'mock'
    }

    const { data: confirmation, error: confirmInsertErr } = await supabaseAdmin
      .from('payment_confirmations')
      .insert({
        challenge_id: challengeId,
        tx_hash: txHash,
        provider,
        amount_paid_atomic: verificationResult.amountPaidAtomic,
        provider_raw: {
          verified_at: new Date().toISOString(),
          request_id: requestId
        }
      })
      .select()
      .single()

    if (confirmInsertErr) {
      // Check if this is a uniqueness violation (race condition)
      if (confirmInsertErr.code === '23505') {
        // Concurrent request won - re-query and return existing
        logger.info('queue/confirm concurrent confirmation detected', { requestId, challengeId, txHash })
        const { data: existing, error: existingErr } = await supabaseAdmin
          .from('payment_confirmations')
          .select('*, payment_challenges!inner(track_id)')
          .eq('challenge_id', challengeId)
          .single()

        if (existingErr) {
          logger.error('queue/confirm failed to retrieve concurrent confirmation', {
            requestId,
            challengeId,
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
          // Defensive: Validate joined data structure
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
            trackId,
            status: 'PAID',
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

    // 8. Transition track to PAID status
    const { data: paidTrack, error: trackUpdateErr } = await supabaseAdmin
      .from('tracks')
      .update({
        status: 'PAID',
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

    // 9. Broadcast queue update
    await broadcastQueueUpdate({
      queue: [paidTrack],
      action: 'updated',
      trackId: paidTrack.id
    })

    // 10. Enqueue generation (fire-and-forget, non-blocking)
    try {
      const baseUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
      const workerUrl = `${baseUrl}/api/worker/generate?track_id=${encodeURIComponent(paidTrack.id)}`
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
      status: 'PAID',
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
