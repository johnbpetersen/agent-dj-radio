// api/queue/confirm.ts
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
import type { X402ConfirmRequest, X402ConfirmResponse, X402Challenge, Track } from '../../src/types/index.js'

function extractStoredChallenge(t: Track): X402Challenge | null {
  if (
    t.x402_challenge_nonce &&
    t.x402_challenge_amount &&
    t.x402_challenge_asset &&
    t.x402_challenge_chain &&
    t.x402_challenge_pay_to &&
    t.x402_challenge_expires_at
  ) {
    return {
      nonce: t.x402_challenge_nonce,
      amount: t.x402_challenge_amount,
      asset: t.x402_challenge_asset,
      chain: t.x402_challenge_chain,
      payTo: t.x402_challenge_pay_to,
      expiresAt: t.x402_challenge_expires_at
    }
  }
  return null
}

async function confirmHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  res.setHeader('Cache-Control', 'no-store')

  try {
    const { track_id, payment_proof }: X402ConfirmRequest = req.body

    if (!track_id) {
      res.status(400).json({ error: 'Track ID is required', correlationId })
      return
    }
    if (!payment_proof) {
      res.status(400).json({ error: 'Payment proof is required', correlationId })
      return
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      'unknown'

    await auditPaymentSubmitted(
      supabaseAdmin,
      track_id,
      payment_proof,
      correlationId,
      req.headers['user-agent'],
      ip
    )

    const track = await getTrackById(supabaseAdmin, track_id)
    if (!track) {
      res.status(404).json({ error: 'Track not found', correlationId })
      return
    }

    // Idempotent success if already PAID
    if (track.status === 'PAID') {
      const response: X402ConfirmResponse = {
        track: sanitizeForClient(track, ['eleven_request_id', 'x402_payment_tx']),
        payment_verified: true,
        correlationId
      }
      res.status(200).json(response)
      return
    }

    if (track.status !== 'PENDING_PAYMENT') {
      res.status(400).json({
        error: `Cannot confirm payment for track with status: ${track.status}`,
        correlationId
      })
      return
    }

    // Prefer stored challenge
    const stored = extractStoredChallenge(track)
    const { challenge } =
      stored
        ? { challenge: stored }
        : await buildChallenge({ priceUsd: track.price_usd, trackId: track.id })

    const verification = await verifyPayment({
      challenge,
      paymentProof: payment_proof,
      trackId: track.id
    })

    if (!verification.verified) {
      res.status(400).json({
        error: 'Payment verification failed',
        details: verification.error,
        correlationId
      })
      return
    }

    const paidTrack = await confirmTrackPayment(supabaseAdmin, track.id, verification.proofData)
    if (!paidTrack) {
      const err = new Error(`Failed to update track ${track.id} to PAID status`)
      errorTracker.trackError(err, {
        operation: 'confirm-payment',
        correlationId,
        trackId: track.id
      })
      res.status(500).json({ error: 'Failed to confirm payment', correlationId })
      return
    }

    await auditPaymentConfirmed(
      supabaseAdmin,
      track.id,
      verification.proofData?.transaction_hash || 'unknown',
      correlationId
    )

    await broadcastQueueUpdate({
      queue: [paidTrack],
      action: 'updated',
      trackId: paidTrack.id
    })

    const response: X402ConfirmResponse = {
      track: sanitizeForClient(paidTrack, ['eleven_request_id', 'x402_payment_tx']),
      payment_verified: true,
      correlationId
    }

    res.status(200).json(response)
    return
  } catch (error) {
    const errorResponse = handleApiError(error, 'queue/confirm', { correlationId })
    res.status(500).json(errorResponse)
    return
  } finally {
    logger.requestComplete(req.url || '/api/queue/confirm', Date.now() - startTime, {
      correlationId,
      method: req.method || 'POST',
      statusCode: res.statusCode
    })
  }
}

export default secureHandler(confirmHandler, securityConfigs.user)