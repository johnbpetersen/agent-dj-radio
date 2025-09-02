import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { getTrackById, confirmTrackPayment } from '../../src/server/db'
import { verifyPayment, buildChallenge } from '../../src/server/x402'
import { broadcastQueueUpdate } from '../../src/server/realtime'
import { logger, generateCorrelationId } from '../../src/lib/logger'
import { errorTracker, handleApiError } from '../../src/lib/error-tracking'
import { auditPaymentSubmitted, auditPaymentConfirmed } from '../../src/server/x402-audit'
import { secureHandler, securityConfigs } from '../_shared/secure-handler'
import { sanitizeForClient } from '../_shared/security'
import type { X402ConfirmRequest, X402ConfirmResponse } from '../../src/types'

async function confirmHandler(req: VercelRequest, res: VercelResponse) {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  logger.apiRequest(req.method, req.url || '/api/queue/confirm', { correlationId })

  try {
    const { track_id, payment_proof }: X402ConfirmRequest = req.body

    // Validation
    if (!track_id) {
      logger.apiResponse(req.method, req.url || '/api/queue/confirm', 400, Date.now() - startTime, { 
        correlationId, 
        error: 'Track ID required' 
      })
      return res.status(400).json({ error: 'Track ID is required', correlationId })
    }

    if (!payment_proof) {
      logger.apiResponse(req.method, req.url || '/api/queue/confirm', 400, Date.now() - startTime, { 
        correlationId, 
        error: 'Payment proof required' 
      })
      return res.status(400).json({ error: 'Payment proof is required', correlationId })
    }

    logger.info('x402 confirm payment request', {
      correlationId,
      trackId: track_id,
      proofLength: payment_proof?.length || 0
    })

    // Audit trail: log payment submission
    await auditPaymentSubmitted(
      supabaseAdmin,
      track_id,
      payment_proof,
      correlationId,
      req.headers['user-agent'],
      req.headers['x-forwarded-for'] as string || req.ip
    )

    // Get track
    const track = await getTrackById(supabaseAdmin, track_id)
    
    if (!track) {
      logger.warn('Track not found for payment confirmation', {
        correlationId,
        trackId: track_id
      })
      
      logger.apiResponse(req.method, req.url || '/api/queue/confirm', 404, Date.now() - startTime, { 
        correlationId, 
        trackId: track_id 
      })
      return res.status(404).json({ error: 'Track not found', correlationId })
    }

    // Idempotency: if already PAID, return success
    if (track.status === 'PAID') {
      logger.info('Track already paid, returning success', {
        correlationId,
        trackId: track.id,
        existingPaymentTx: track.x402_payment_tx
      })
      
      const response: X402ConfirmResponse = {
        track,
        payment_verified: true,
        correlationId
      }
      
      logger.apiResponse(req.method, req.url || '/api/queue/confirm', 200, Date.now() - startTime, { 
        correlationId, 
        trackId: track.id,
        idempotent: true 
      })
      return res.status(200).json(response)
    }

    // Only allow confirmation for PENDING_PAYMENT tracks
    if (track.status !== 'PENDING_PAYMENT') {
      logger.warn('Invalid track status for payment confirmation', {
        correlationId,
        trackId: track.id,
        status: track.status
      })
      
      logger.apiResponse(req.method, req.url || '/api/queue/confirm', 400, Date.now() - startTime, { 
        correlationId, 
        trackId: track.id,
        status: track.status 
      })
      return res.status(400).json({ 
        error: `Cannot confirm payment for track with status: ${track.status}`,
        correlationId
      })
    }

    // Rebuild the original challenge for verification
    const { challenge } = await buildChallenge({
      priceUsd: track.price_usd,
      trackId: track.id
    })

    logger.info('Starting x402 payment verification', {
      correlationId,
      trackId: track.id,
      priceUsd: track.price_usd,
      challengeAmount: challenge.amount
    })

    // Verify payment with enhanced retry and logging
    const verification = await verifyPayment({
      challenge,
      paymentProof: payment_proof,
      trackId: track.id
    })

    if (!verification.verified) {
      logger.warn('x402 payment verification failed', {
        correlationId,
        trackId: track.id,
        error: verification.error
      })
      
      logger.apiResponse(req.method, req.url || '/api/queue/confirm', 400, Date.now() - startTime, { 
        correlationId, 
        trackId: track.id,
        verificationError: verification.error 
      })
      return res.status(400).json({
        error: 'Payment verification failed',
        details: verification.error,
        correlationId
      })
    }

    logger.info('x402 payment verification successful', {
      correlationId,
      trackId: track.id,
      transactionHash: verification.proofData?.transaction_hash
    })

    // Update track to PAID status with proof
    const paidTrack = await confirmTrackPayment(
      supabaseAdmin,
      track.id,
      verification.proofData
    )

    if (!paidTrack) {
      const error = new Error(`Failed to update track ${track.id} to PAID status`)
      errorTracker.trackError(error, {
        operation: 'confirm-payment',
        correlationId,
        trackId: track.id
      })
      
      logger.apiResponse(req.method, req.url || '/api/queue/confirm', 500, Date.now() - startTime, { 
        correlationId, 
        trackId: track.id,
        error: 'Failed to confirm payment in database'
      })
      return res.status(500).json({ error: 'Failed to confirm payment', correlationId })
    }

    logger.trackStatusChanged(track.id, 'PENDING_PAYMENT', 'PAID', {
      correlationId,
      transactionHash: verification.proofData?.transaction_hash,
      paymentAmount: challenge.amount
    })

    // Audit trail: log payment confirmation
    await auditPaymentConfirmed(
      supabaseAdmin,
      track.id,
      verification.proofData?.transaction_hash || 'unknown',
      correlationId
    )

    // Broadcast queue update
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

    logger.apiResponse(req.method, req.url || '/api/queue/confirm', 200, Date.now() - startTime, { 
      correlationId, 
      trackId: paidTrack.id,
      transactionHash: verification.proofData?.transaction_hash
    })

    res.status(200).json(response)

  } catch (error) {
    const errorResponse = handleApiError(error, 'queue/confirm', { correlationId })
    
    logger.apiResponse(req.method, req.url || '/api/queue/confirm', 500, Date.now() - startTime, { 
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    
    res.status(500).json(errorResponse)
  }
}

export default secureHandler(confirmHandler, securityConfigs.user)