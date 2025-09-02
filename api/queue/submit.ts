import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { calculatePrice, validateDuration } from '../../src/server/pricing'
import { createTrack, upsertUser, updateUserLastSubmit } from '../../src/server/db'
import { checkSubmitCooldown, recordSubmit } from '../../src/server/rate-limit'
import { buildChallenge } from '../../src/server/x402'
import { broadcastQueueUpdate } from '../../src/server/realtime'
import { logger, generateCorrelationId } from '../../src/lib/logger'
import { errorTracker, handleApiError } from '../../src/lib/error-tracking'
import type { SubmitTrackRequest, X402ChallengeResponse } from '../../src/types'

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

    if (prompt.trim().length > 500) {
      return res.status(400).json({ error: 'Prompt too long (max 500 characters)' })
    }

    // Server-side duration validation (security)
    if (!validateDuration(duration_seconds)) {
      return res.status(400).json({ 
        error: 'Invalid duration. Must be 60, 90, or 120 seconds.' 
      })
    }

    // Check rate limiting
    const cooldownCheck = checkSubmitCooldown({ userId: user_id })
    if (!cooldownCheck.allowed) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        retry_after_seconds: cooldownCheck.remainingSeconds 
      })
    }

    // Verify user exists and is not banned
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, banned, display_name')
      .eq('id', user_id)
      .single()

    if (userError || !user) {
      return res.status(400).json({ error: 'Invalid user' })
    }

    if (user.banned) {
      return res.status(403).json({ error: 'User is banned' })
    }

    // Server calculates price (ignore any client-provided price)
    const price_usd = calculatePrice(duration_seconds)

    const x402Enabled = process.env.ENABLE_X402 === 'true'
    
    if (!x402Enabled) {
      // Sprint 1 behavior: create PAID track immediately
      const track = await createTrack(supabaseAdmin, {
        user_id,
        prompt: prompt.trim(),
        duration_seconds,
        source: 'GENERATED',
        status: 'PAID',
        price_usd,
        x402_payment_tx: null,
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

      // Record successful submit for rate limiting
      recordSubmit({ userId: user_id })
      
      // Update user last submit time
      await updateUserLastSubmit(supabaseAdmin, user_id)

      // Broadcast queue update
      await broadcastQueueUpdate({
        queue: [track],
        action: 'added',
        trackId: track.id
      })

      return res.status(201).json({ track })
    }

    // x402 flow: create PENDING_PAYMENT track and return challenge
    const track = await createTrack(supabaseAdmin, {
      user_id,
      prompt: prompt.trim(),
      duration_seconds,
      source: 'GENERATED',
      status: 'PENDING_PAYMENT',
      price_usd,
      x402_payment_tx: null,
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

    // Build x402 challenge
    const { challenge } = await buildChallenge({
      priceUsd: price_usd,
      trackId: track.id
    })

    // Record submit for rate limiting (even for pending payments)
    recordSubmit({ userId: user_id })
    
    // Update user last submit time
    await updateUserLastSubmit(supabaseAdmin, user_id)

    const response: X402ChallengeResponse = {
      challenge,
      track_id: track.id
    }

    // Return HTTP 402 Payment Required with challenge
    res.status(402).json(response)

  } catch (error) {
    console.error('Submit track error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}