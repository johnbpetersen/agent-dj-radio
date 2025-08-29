import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { calculatePrice, validateDuration } from '../../src/server/pricing'
import { createTrack } from '../../src/server/db'
import type { SubmitTrackRequest, SubmitTrackResponse } from '../../src/types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { prompt, duration_seconds, user_id }: SubmitTrackRequest = req.body

    // Validation
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    if (!user_id) {
      return res.status(400).json({ error: 'User ID is required' })
    }

    if (!validateDuration(duration_seconds)) {
      return res.status(400).json({ 
        error: 'Invalid duration. Must be 60, 90, or 120 seconds.' 
      })
    }

    // Verify user exists and is not banned
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, banned')
      .eq('id', user_id)
      .single()

    if (userError || !user) {
      return res.status(400).json({ error: 'Invalid user' })
    }

    if (user.banned) {
      return res.status(403).json({ error: 'User is banned' })
    }

    // Calculate price
    const price_usd = calculatePrice(duration_seconds)

    // Create track with PAID status (simulated payment for Sprint 1)
    const track = await createTrack(supabaseAdmin, {
      user_id,
      prompt: prompt.trim(),
      duration_seconds,
      source: 'GENERATED',
      status: 'PAID',
      price_usd,
      x402_payment_tx: null, // Will be populated in Sprint 2
      eleven_request_id: null,
      audio_url: null,
      rating_score: 0,
      rating_count: 0,
      last_played_at: null,
      started_at: null,
      finished_at: null
    })

    if (!track) {
      return res.status(500).json({ error: 'Failed to create track' })
    }

    const response: SubmitTrackResponse = { track }
    res.status(201).json(response)
  } catch (error) {
    console.error('Submit track error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}