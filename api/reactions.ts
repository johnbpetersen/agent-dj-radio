import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './_shared/supabase'
import { upsertReaction, updateTrackRating } from '../src/server/db'
import type { ReactionRequest, ReactionResponse, ReactionKind } from '../src/types'

const VALID_REACTION_KINDS: ReactionKind[] = ['LOVE', 'FIRE', 'SKIP']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { track_id, user_id, kind }: ReactionRequest = req.body

    // Validation
    if (!track_id || !user_id || !kind) {
      return res.status(400).json({ 
        error: 'Missing required fields: track_id, user_id, kind' 
      })
    }

    if (!VALID_REACTION_KINDS.includes(kind)) {
      return res.status(400).json({ 
        error: `Invalid reaction kind. Must be one of: ${VALID_REACTION_KINDS.join(', ')}` 
      })
    }

    // Verify track exists
    const { data: track, error: trackError } = await supabaseAdmin
      .from('tracks')
      .select('id')
      .eq('id', track_id)
      .single()

    if (trackError || !track) {
      return res.status(404).json({ error: 'Track not found' })
    }

    // Verify user exists and is not banned
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, banned')
      .eq('id', user_id)
      .single()

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (user.banned) {
      return res.status(403).json({ error: 'User is banned' })
    }

    // Upsert reaction (replaces existing reaction from same user)
    const reaction = await upsertReaction(supabaseAdmin, track_id, user_id, kind)
    if (!reaction) {
      return res.status(500).json({ error: 'Failed to save reaction' })
    }

    // Recompute track rating
    const updatedTrack = await updateTrackRating(supabaseAdmin, track_id)
    if (!updatedTrack) {
      return res.status(500).json({ error: 'Failed to update track rating' })
    }

    const response: ReactionResponse = {
      reaction,
      track: updatedTrack
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Reaction error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}