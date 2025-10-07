// api/queue/confirm.ts
// Verify x402 payment and transition track from PENDING_PAYMENT to PAID

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabaseAdmin } from '../_shared/supabase.js'
import { verifyPayment } from '../_shared/payments/x402-cdp.js'
import { serverEnv } from '../../src/config/env.server.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { errorTracker } from '../../src/lib/error-tracking.js'
import { broadcastQueueUpdate } from '../../src/server/realtime.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'

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

  try {
    // Validate request body
    const parseResult = confirmRequestSchema.safeParse(req.body)
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      logger.warn('queue/confirm validation failed', { requestId, errors })
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: `Invalid request: ${errors}` },
        requestId
      })
      return
    }

    const { challengeId, txHash } = parseResult.data

    logger.info('queue/confirm processing', { requestId, challengeId, txHash })

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
          txHash: txHash.substring(0, 10) + '...',
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
      throw new Error(`Database error: ${confirmCheckErr.message}`)
    }

    if (existingConfirmation) {
      // Idempotent response: return existing confirmation
      const trackId = (existingConfirmation as any).payment_challenges.track_id
      logger.info('queue/confirm idempotent (already confirmed)', {
        requestId,
        challengeId,
        txHash,
        trackId,
        existingConfirmationId: existingConfirmation.id
      })

      // Load track to return current status
      const { data: track } = await supabaseAdmin
        .from('tracks')
        .select('*')
        .eq('id', trackId)
        .single()

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

    // 4. Branch: CDP verification or mock
    let verificationResult: { ok: true; amountPaidAtomic: number } | { ok: false; code: string; detail?: string }

    if (serverEnv.ENABLE_X402 && serverEnv.X402_API_KEY) {
      // Real CDP verification
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
      // Neither enabled - configuration error
      logger.error('queue/confirm no payment verification method enabled', { requestId })
      res.status(500).json({
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Payment verification is not configured'
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
        txHash,
        code: verificationResult.code,
        detail: verificationResult.detail
      })

      // Audit log (structured)
      logger.info('queue/confirm audit: verification failed', {
        requestId,
        challengeId,
        txHash,
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
          message: verificationResult.detail || 'Payment verification failed'
        },
        requestId
      })
      return
    }

    // 6. Verification successful! Insert confirmation record
    const { data: confirmation, error: confirmInsertErr } = await supabaseAdmin
      .from('payment_confirmations')
      .insert({
        challenge_id: challengeId,
        tx_hash: txHash,
        provider: serverEnv.ENABLE_X402 ? 'cdp' : 'mock',
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
        const { data: existing } = await supabaseAdmin
          .from('payment_confirmations')
          .select('*, payment_challenges!inner(track_id)')
          .eq('challenge_id', challengeId)
          .single()

        if (existing) {
          const trackId = (existing as any).payment_challenges.track_id
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
      throw new Error(`Failed to record payment confirmation: ${confirmInsertErr.message}`)
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
          provider: serverEnv.ENABLE_X402 ? 'cdp' : 'mock'
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
      throw new Error(`Failed to update track status: ${trackUpdateErr?.message}`)
    }

    logger.info('queue/confirm payment confirmed', {
      requestId,
      challengeId,
      txHash,
      trackId: challenge.track_id,
      amountPaidAtomic: verificationResult.amountPaidAtomic,
      durationMs: Date.now() - startTime
    })

    // Audit log (structured, no secrets)
    logger.info('queue/confirm audit: success', {
      requestId,
      challengeId,
      txHash,
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

    res.status(500).json({
      error: {
        code: 'PROVIDER_ERROR',
        message: 'Internal server error during payment confirmation'
      },
      requestId
    })
  }
}

export default secureHandler(confirmHandler, securityConfigs.user)
