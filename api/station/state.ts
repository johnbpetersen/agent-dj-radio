// api/station/state.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import supabase from '../_shared/supabase'

const STATION_ID = Number(process.env.STATION_ID || '1')

// remove sensitive/internal fields before sending to client
function sanitizeTrack<T extends Record<string, any>>(track: T | null): T | null {
  if (!track) return track
  const copy: any = { ...track }
  delete copy.eleven_request_id
  return copy
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')

  try {
    // 1) Load station_state
    const { data: state, error: stateErr } = await supabase
      .from('station_state')
      .select('id,current_track_id,current_started_at,updated_at')
      .eq('id', STATION_ID)
      .single()

    if (stateErr) {
      console.error('[state] station_state error:', stateErr)
      return res.status(500).json({ error: 'Failed to load station_state', detail: stateErr.message })
    }
    if (!state) return res.status(404).json({ error: 'station_state not found' })

    // 2) All playable tracks (anything with a real audio_url)
    const { data: playable, error: playableErr } = await supabase
      .from('tracks')
      .select('*')
      .not('audio_url', 'is', null)
      .neq('audio_url', '')
      .order('created_at', { ascending: true })
      .limit(500)

    if (playableErr) {
      console.error('[state] playable error:', playableErr)
      return res.status(500).json({ error: 'Failed to load tracks', detail: playableErr.message })
    }

    const playableArr = (playable ?? []).map(sanitizeTrack)

    // 3) Resolve the current track
    let currentTrack = null as any
    let currentTrackId = state.current_track_id as string | null
    let currentStartedAt = state.current_started_at as string | null

    if (currentTrackId) {
      const { data: trackRow, error: trackErr } = await supabase
        .from('tracks')
        .select('*')
        .eq('id', currentTrackId)
        .single()
      if (!trackErr && trackRow) currentTrack = sanitizeTrack(trackRow)
    }

    // If station has no current track, bootstrap it to the first playable, persist to DB
    if (!currentTrack && playableArr.length > 0) {
      const first = playableArr[0]
      currentTrack = first
      currentTrackId = first.id
      currentStartedAt = new Date().toISOString()

      // Persist station_state (and mark the chosen track as PLAYING if needed)
      const updates: Record<string, any> = {
        current_track_id: currentTrackId,
        current_started_at: currentStartedAt,
        updated_at: new Date().toISOString(),
      }

      const [{ error: upsertErr }, { error: markErr }] = await Promise.all([
        supabase
          .from('station_state')
          .update(updates)
          .eq('id', STATION_ID),
        supabase
          .from('tracks')
          .update({
            status: 'PLAYING',
            started_at: currentStartedAt,
            last_played_at: currentStartedAt,
          })
          .eq('id', currentTrackId),
      ])

      if (upsertErr) console.error('[state] failed to persist station_state bootstrap:', upsertErr)
      if (markErr) console.error('[state] failed to mark current track PLAYING:', markErr)
    }

    // 4) Build the queue: all other playable tracks, normalized to READY in the response
    const queue = playableArr
      .filter(t => currentTrackId ? t.id !== currentTrackId : true)
      .map(t => ({ ...t, status: 'READY' }))

    // 5) Playhead calculation
    let playhead_seconds = 0
    if (currentStartedAt) {
      const started = new Date(currentStartedAt).getTime()
      playhead_seconds = Math.max(0, Math.floor((Date.now() - started) / 1000))
    }

    return res.status(200).json({
      station_state: {
        id: state.id,
        current_track_id: currentTrackId,
        current_started_at: currentStartedAt,
        updated_at: state.updated_at,
        current_track: currentTrack ? { ...currentTrack, status: 'PLAYING' } : null,
      },
      queue,
      playhead_seconds,
    })
  } catch (err: any) {
    console.error('[/api/station/state] unexpected error:', err)
    return res.status(500).json({ error: err?.message || 'Internal Server Error' })
  }
}