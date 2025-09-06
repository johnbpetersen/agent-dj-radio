import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { getTrackById, confirmTrackPayment } from '../../src/server/db.js'
import { verifyPayment, buildChallenge } from '../../src/server/x402.js'
import { broadcastQueueUpdate } from '../../src/server/realtime.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { errorTracker, handleApiError } from '../../src/lib/error-tracking.js'
import { auditPaymentSubmitted, auditPaymentConfirmed } from '../../src/server/x402-audit.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import type { X402Challenge, X402ConfirmRequest, X402ConfirmResponse } from '../../src/types'

// Best-effort client IP extraction for Vercel/Node
function getClientIp(req: VercelRequest): string | undefined {
  const h = req.headers['x-forwarded-for']
  const forwarded = (Array.isArray(h) ? h[0] : h) as string | undefined
  const viaHeader = forwarded?.split(',')[0]?.trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viaSocket = (req as any).socket?.remoteAddress as string | undefined
  return viaHeader || viaSocket || undefined
}

async function confirmHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  logger.info('queue/confirm request', { correlationId })

  try {
    const { track_id, payment_proof }: X402ConfirmRequest = req.body || {}

    // Basic validation
    if (!track_id) {
      logger.warn('queue/confirm missing track_id', { correlationId })
      res.status(400).json({ error: 'Track ID is required' })
      return
    }
    if (!payment_proof) {
      logger.warn('queue/confirm missing payment_proof', { correlationId, trackId: track_id })
      res.status(400).json({ error: 'Payment proof is required' })
      return
    }

    // Audit: payment submitted
    await auditPaymentSubmitted(
      supabaseAdmin,
      track_id,
      payment_proof,
      correlationId,
      req.headers['user-agent'] as string | undefined,
      getClientIp(req)
    )

    // Load track
    const track = await getTrackById(supabaseAdmin, track_id)

    if (!track) {
      logger.warn('queue/confirm track not found', { correlationId, trackId: track_id })
      res.status(404).json({ error: 'Track not found' })
      return
    }

    // Idempotent success if already paid
    if (track.status === 'PAID') {
      logger.info('queue/confirm idempotent success (already PAID)', {
        correlationId,
        trackId: track.id
      })
      const response: X402ConfirmResponse = {
        track: sanitizeForClient(track, ['eleven_request_id', 'x402_payment_tx']),
        payment_verified: true
      }
      res.status(200).json(response)
      return
    }

    // Only allow confirm for PENDING_PAYMENT
    if (track.status !== 'PENDING_PAYMENT') {
      logger.warn('queue/confirm invalid status', {
        correlationId,
        trackId: track.id,
        status: track.status
      })
      res.status(400).json({ error: `Cannot confirm payment for track with status: ${track.status}` })
      return
    }

    // Rehydrate the ORIGINAL challenge if it was persisted on the track.
    // Fall back to rebuilding if missing (should be rare).
    // We access via "any" to avoid widening your Track type.
    const t: any = track
    let challenge: X402Challenge | null = null

    if (
      t.x402_challenge_nonce &&
      t.x402_challenge_amount &&
      t.x402_challenge_asset &&
      t.x402_challenge_chain &&
      t.x402_challenge_pay_to &&
      t.x402_challenge_expires_at
    ) {
      challenge = {
        amount: String(t.x402_challenge_amount),
        asset: String(t.x402_challenge_asset),
        chain: String(t.x402_challenge_chain),
        payTo: String(t.x402_challenge_pay_to),
        nonce: String(t.x402_challenge_nonce),
        expiresAt: new Date(t.x402_challenge_expires_at).toISOString()
      }
      logger.info('queue/confirm using persisted challenge', { correlationId, trackId: track.id })
    } else {
      const rebuilt = await buildChallenge({ priceUsd: track.price_usd, trackId: track.id })
      challenge = rebuilt.challenge
      logger.warn('queue/confirm had to rebuild challenge (not persisted)', {
        correlationId,
        trackId: track.id
      })
    }

    // Verify payment
    const verification = await verifyPayment({
      challenge,
      paymentProof: payment_proof,
      trackId: track.id
    })

    if (!verification.verified) {
      logger.warn('queue/confirm verification failed', {
        correlationId,
        trackId: track.id,
        error: verification.error
      })
      res.status(400).json({
        error: 'Payment verification failed',
        details: verification.error
      })
      return
    }

    // Update track -> PAID with proof
    const paidTrack = await confirmTrackPayment(supabaseAdmin, track.id, verification.proofData)

    if (!paidTrack) {
      const err = new Error(`Failed to update track ${track.id} to PAID`)
      errorTracker.trackError(err, { operation: 'confirm-payment', correlationId, trackId: track.id })
      res.status(500).json({ error: 'Failed to confirm payment' })
      return
    }

    logger.info('queue/confirm payment confirmed', {
      correlationId,
      trackId: track.id,
      transactionHash: verification.proofData?.transaction_hash,
      durationMs: Date.now() - startTime
    })

    // Audit: confirmed
    await auditPaymentConfirmed(
      supabaseAdmin,
      track.id,
      verification.proofData?.transaction_hash || 'unknown',
      correlationId
    )

    // Broadcast to UI
    await broadcastQueueUpdate({
      queue: [paidTrack],
      action: 'updated',
      trackId: paidTrack.id
    })

    // 🔔 Trigger the generator to process PAID tracks (fire-and-forget).
    // This mirrors the non-x402 path in /api/queue/submit.
    try {
      const baseUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
      const workerUrl = `${baseUrl}/api/worker/generate?track_id=${encodeURIComponent(paidTrack.id)}`
      fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).catch(err => logger.warn('worker trigger failed (non-blocking)', { correlationId, error: err?.message }))
    } catch (err) {
      logger.warn('worker trigger error (non-blocking)', { correlationId, error: (err as Error)?.message })
    }

    const response: X402ConfirmResponse = {
      track: sanitizeForClient(paidTrack, ['eleven_request_id', 'x402_payment_tx']),
      payment_verified: true
    }
    res.status(200).json(response)
  } catch (error) {
    const errorResponse = handleApiError(error, 'queue/confirm', { correlationId })
    logger.error(
      'queue/confirm unhandled error',
      { correlationId },
      error instanceof Error ? error : new Error(String(error))
    )
    res.status(500).json(errorResponse)
  }
}

export default secureHandler(confirmHandler, securityConfigs.user)