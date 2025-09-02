import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { getTrackById, confirmTrackPayment } from '../../src/server/db'
import { verifyPayment, buildChallenge } from '../../src/server/x402'
import { broadcastQueueUpdate } from '../../src/server/realtime'
import type { X402ConfirmRequest, X402ConfirmResponse } from '../../src/types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { track_id, payment_proof }: X402ConfirmRequest = req.body

    // Validation
    if (!track_id) {
      return res.status(400).json({ error: 'Track ID is required' })
    }

    if (!payment_proof) {
      return res.status(400).json({ error: 'Payment proof is required' })
    }

    // Get track
    const track = await getTrackById(supabaseAdmin, track_id)
    
    if (!track) {
      return res.status(404).json({ error: 'Track not found' })
    }

    // Idempotency: if already PAID, return success
    if (track.status === 'PAID') {
      const response: X402ConfirmResponse = {
        track,
        payment_verified: true
      }
      return res.status(200).json(response)
    }

    // Only allow confirmation for PENDING_PAYMENT tracks
    if (track.status !== 'PENDING_PAYMENT') {
      return res.status(400).json({ 
        error: `Cannot confirm payment for track with status: ${track.status}` 
      })
    }

    // Rebuild the original challenge for verification
    const { challenge } = buildChallenge({
      priceUsd: track.price_usd,
      trackId: track.id
    })

    // Verify payment
    const verification = await verifyPayment({
      challenge,
      paymentProof: payment_proof,
      trackId: track.id
    })

    if (!verification.verified) {
      return res.status(400).json({
        error: 'Payment verification failed',
        details: verification.error
      })
    }

    // Update track to PAID status with proof
    const paidTrack = await confirmTrackPayment(
      supabaseAdmin,
      track.id,
      verification.proofData
    )

    if (!paidTrack) {
      return res.status(500).json({ error: 'Failed to confirm payment' })
    }

    // Broadcast queue update
    await broadcastQueueUpdate({
      queue: [paidTrack],
      action: 'updated',
      trackId: paidTrack.id
    })

    const response: X402ConfirmResponse = {
      track: paidTrack,
      payment_verified: true
    }

    res.status(200).json(response)

  } catch (error) {
    console.error('Confirm payment error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}