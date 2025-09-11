import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { generateMockPaymentProof } from '../../src/server/x402'
import { secureHandler, securityConfigs } from '../_shared/secure-handler'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { handleApiError } from '../../src/lib/error-tracking'

async function mockProofHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  logger.request('/api/x402/mock-proof', { correlationId, method: req.method })

  try {
    const { track_id } = (req.body || {}) as { track_id?: string }
    if (!track_id) {
      return res.status(400).json({ error: 'track_id required' })
    }

    const { data: track, error } = await supabaseAdmin
      .from('tracks')
      .select('x402_challenge_amount,x402_challenge_asset,x402_challenge_chain,x402_challenge_pay_to,x402_challenge_nonce,x402_challenge_expires_at')
      .eq('id', track_id)
      .single()

    if (error || !track) {
      logger.warn('Track not found for mock proof', { correlationId, trackId: track_id })
      return res.status(404).json({ error: 'track not found' })
    }

    const challenge = {
      amount: String(track.x402_challenge_amount),
      asset: String(track.x402_challenge_asset),
      chain: String(track.x402_challenge_chain),
      payTo: String(track.x402_challenge_pay_to),
      nonce: String(track.x402_challenge_nonce),
      expiresAt: new Date(track.x402_challenge_expires_at).toISOString()
    }

    const proof = generateMockPaymentProof(challenge, true)
    
    logger.requestComplete('/api/x402/mock-proof', Date.now() - startTime, {
      correlationId,
      trackId: track_id
    })

    res.status(200).json({ track_id, payment_proof: proof, challenge })
  } catch (error) {
    const errorResponse = handleApiError(error, 'x402/mock-proof', { correlationId })
    
    logger.error('Mock proof generation error', { correlationId }, error instanceof Error ? error : new Error(String(error)))

    res.status(500).json(errorResponse)
  }
}

export default secureHandler(mockProofHandler, securityConfigs.user)