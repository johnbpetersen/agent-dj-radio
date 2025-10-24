import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './_shared/supabase.js'
import { upsertReaction, updateTrackRating } from '../src/server/db.js'
import { secureHandler, securityConfigs } from './_shared/secure-handler.js'
import { sanitizeForClient } from './_shared/security.js'
import type { ReactionRequest, ReactionResponse, ReactionKind } from '../src/types/index.js'

const VALID_REACTION_KINDS: ReactionKind[] = ['LOVE', 'FIRE', 'SKIP']

async function reactionsHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { track_id, user_id, kind }: ReactionRequest = req.body

    // Validation
    if (!track_id || !user_id || !kind) {
      res.status(400).json({
        error: 'Missing required fields: track_id, user_id, kind'
      })
      return
    }

    if (!VALID_REACTION_KINDS.includes(kind)) {
      res.status(400).json({
        error: `Invalid reaction kind. Must be one of: ${VALID_REACTION_KINDS.join(', ')}`
      })
      return
    }

    // Verify track exists
    const { data: track, error: trackError } = await supabaseAdmin
      .from('tracks')
      .select('id')
      .eq('id', track_id)
      .single()

    if (trackError || !track) {
      res.status(404).json({ error: 'Track not found' })
      return
    }

    // Verify user exists and is not banned
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, banned')
      .eq('id', user_id)
      .single()

    if (userError || !user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.banned) {
      res.status(403).json({ error: 'User is banned' })
      return
    }

    // Upsert reaction (replaces existing reaction from same user)
    const reaction = await upsertReaction(supabaseAdmin, track_id, user_id, kind)
    if (!reaction) {
      res.status(500).json({ error: 'Failed to save reaction' })
      return
    }

    // Recompute track rating
    const updatedTrack = await updateTrackRating(supabaseAdmin, track_id)
    if (!updatedTrack) {
      res.status(500).json({ error: 'Failed to update track rating' })
      return
    }

    const response: ReactionResponse = {
      reaction,
      track: sanitizeForClient(updatedTrack, ['eleven_request_id', 'x402_payment_tx']),
      ok: true,
      already_applied: false
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Reaction error:', error)

    // Handle Postgres unique constraint violation (23505) - double-click case
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      console.warn('[Reactions] Duplicate reaction ignored (23505)')
      res.status(200).json({
        ok: true,
        already_applied: true
      })
      return
    }

    res.status(500).json({ error: 'Internal server error' })
  }
}

export default secureHandler(reactionsHandler, securityConfigs.user)