// api/queue/submit.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { calculatePrice, validateDuration } from '../../src/server/pricing.js'
import { createTrack, updateUserLastSubmit } from '../../src/server/db.js'
import { checkSubmitCooldown, recordSubmit } from '../../src/server/rate-limit.js'
import { buildChallenge } from '../../src/server/x402.js'
import { broadcastQueueUpdate } from '../../src/server/realtime.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { sanitizeForClient } from '../_shared/security.js'
import type { SubmitTrackRequest, X402ChallengeResponse } from '../../src/types/index.js'

async function submitHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Avoid caching
  res.setHeader('Cache-Control', 'no-store')

  try {
    const { prompt, duration_seconds, user_id }: SubmitTrackRequest = req.body

    // Validation
    if (!prompt || !prompt.trim()) {
      res.status(400).json({ error: 'Prompt is required' })
      return
    }

    if (!user_id) {
      res.status(400).json({ error: 'User ID is required' })
      return
    }

    if (prompt.trim().length > 500) {
      res.status(400).json({ error: 'Prompt too long (max 500 characters)' })
      return
    }

    // Server-side duration validation (security)
    if (!validateDuration(duration_seconds)) {
      res.status(400).json({ error: 'Invalid duration. Must be 60, 90, or 120 seconds.' })
      return
    }

    // Simple per-user cooldown
    const cooldownCheck = checkSubmitCooldown({ userId: user_id })
    if (!cooldownCheck.allowed) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        retry_after_seconds: cooldownCheck.remainingSeconds
      })
      return
    }

    // Verify user exists (and not banned)
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, banned, display_name')
      .eq('id', user_id)
      .single()

    if (userError || !user) {
      res.status(400).json({ error: 'Invalid user' })
      return
    }
    if (user.banned) {
      res.status(403).json({ error: 'User is banned' })
      return
    }

    // Server-calculated price
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
        res.status(500).json({ error: 'Failed to create track' })
        return
      }

      // Record submit + update last_submit_at
      recordSubmit({ userId: user_id })
      await updateUserLastSubmit(supabaseAdmin, user_id)

      // Broadcast queue update
      await broadcastQueueUpdate({
        queue: [track],
        action: 'added',
        trackId: track.id
      })

      // Fire-and-forget worker trigger (non-blocking)
      try {
        const baseUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
        const workerUrl = `${baseUrl}/api/worker/generate`
        fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }).catch(err => console.warn('Worker trigger failed (non-blocking):', err?.message))
      } catch (err) {
        console.warn('Worker trigger error (non-blocking):', err)
      }

      res
        .status(201)
        .json({ track: sanitizeForClient(track, ['eleven_request_id', 'x402_payment_tx']) })
      return
    }

    // x402 flow: create PENDING_PAYMENT track and return a payment challenge
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
      res.status(500).json({ error: 'Failed to create track' })
      return
    }

    // Build x402 challenge
    const { challenge } = await buildChallenge({
      priceUsd: price_usd,
      trackId: track.id
    })

    // Persist challenge on the track (so confirm can rebuild/inspect)
    const { error: persistErr } = await supabaseAdmin
      .from('tracks')
      .update({
        x402_challenge_nonce: challenge.nonce,
        // store amount as text; PostgREST casts to bigint on the DB side
        x402_challenge_amount: challenge.amount,
        x402_challenge_asset: challenge.asset,
        x402_challenge_chain: challenge.chain,
        x402_challenge_pay_to: challenge.payTo,
        x402_challenge_expires_at: challenge.expiresAt
      })
      .eq('id', track.id)

    if (persistErr) {
      console.warn('[submit] failed to persist x402 challenge:', persistErr.message)
    }

    // Record submit + update last_submit_at
    recordSubmit({ userId: user_id })
    await updateUserLastSubmit(supabaseAdmin, user_id)

    const response: X402ChallengeResponse = {
      challenge,
      track_id: track.id
    }

    // HTTP 402 with x402 headers so agents/browsers can react quickly
    res.setHeader('X-Payment-Required', 'x402')
    res.setHeader('X-Payment-Provider', 'CDP')
    res.setHeader('X-Payment-Asset', challenge.asset)
    res.setHeader('X-Payment-Amount', challenge.amount)
    res.setHeader('X-Payment-Chain', challenge.chain)
    res.setHeader('X-Payment-PayTo', challenge.payTo)
    res.setHeader('X-Payment-Nonce', challenge.nonce)
    res.setHeader('X-Payment-ExpiresAt', challenge.expiresAt)

    res.status(402).json(response)
    return
  } catch (error) {
    console.error('Submit track error:', error)
    res.status(500).json({ error: 'Internal server error' })
    return
  }
}

export default secureHandler(submitHandler, securityConfigs.user)