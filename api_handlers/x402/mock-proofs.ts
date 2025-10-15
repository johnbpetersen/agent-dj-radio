// api/x402/mock-proof.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { generateMockPaymentProof } from '../../src/server/x402.js'
import type { X402Challenge, Track } from '../../src/types/index.js'

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

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  res.setHeader('Cache-Control', 'no-store')

  try {
    const { track_id, valid = true } = req.body as { track_id?: string; valid?: boolean }

    if (!track_id) {
      res.status(400).json({ error: 'track_id is required' })
      return
    }

    const { data: track, error } = await supabaseAdmin
      .from('tracks')
      .select('*')
      .eq('id', track_id)
      .single()

    if (error || !track) {
      res.status(404).json({ error: 'Track not found' })
      return
    }

    const t = track as Track
    const challenge = extractStoredChallenge(t)
    if (!challenge) {
      res.status(400).json({
        error: 'No stored challenge on track. Submit first to create a challenge (HTTP 402).'
      })
      return
    }

    const payment_proof = generateMockPaymentProof(challenge, Boolean(valid))

    res.status(200).json({
      track_id,
      challenge,
      payment_proof
    })
    return
  } catch (err) {
    console.error('[mock-proof] error:', err)
    res.status(500).json({ error: 'Internal server error' })
    return
  }
}

export default secureHandler(handler, securityConfigs.user)