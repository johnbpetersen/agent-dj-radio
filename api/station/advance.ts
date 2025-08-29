import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { getStationState, updateStationState, getTracksByStatus, updateTrackStatus, createTrack } from '../../src/server/db'
import { selectNextTrack, createReplayTrack } from '../../src/server/selectors'
import { calculatePlayhead, isTrackFinished } from '../../src/server/station'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Get current station state
    const stationState = await getStationState(supabaseAdmin)
    if (!stationState) {
      return res.status(500).json({ error: 'Failed to get station state' })
    }

    const currentTrack = stationState.current_track || null
    const playheadSeconds = calculatePlayhead(stationState)
    
    // If current track is still playing, don't advance
    if (currentTrack && !isTrackFinished(currentTrack, playheadSeconds)) {
      return res.status(200).json({
        message: 'Current track still playing',
        advanced: false,
        current_track: currentTrack,
        playhead_seconds: playheadSeconds
      })
    }

    // Mark current track as DONE if it exists
    if (currentTrack) {
      await updateTrackStatus(
        supabaseAdmin,
        currentTrack.id,
        'DONE',
        { last_played_at: new Date().toISOString() }
      )
    }

    // Get available tracks for selection
    const availableTracks = await getTracksByStatus(supabaseAdmin, ['READY', 'DONE'])
    
    // Select next track
    let nextTrack = selectNextTrack(availableTracks)
    let replayCreated = null

    // If no READY track, create a replay from best DONE track
    if (!nextTrack) {
      const doneTracks = availableTracks.filter(t => t.status === 'DONE')
      if (doneTracks.length > 0) {
        const bestReplay = selectNextTrack(doneTracks) // This will pick the best replay candidate
        if (bestReplay) {
          const replayData = createReplayTrack(bestReplay)
          replayCreated = await createTrack(supabaseAdmin, replayData)
          nextTrack = replayCreated
        }
      }
    }

    if (!nextTrack) {
      // No tracks available, clear station state
      await updateStationState(supabaseAdmin, {
        current_track_id: null,
        current_started_at: null
      })

      return res.status(200).json({
        message: 'No tracks available to play',
        advanced: true,
        current_track: null,
        playhead_seconds: 0,
        replay_created: null
      })
    }

    // Update track to PLAYING
    const playingTrack = await updateTrackStatus(
      supabaseAdmin,
      nextTrack.id,
      'PLAYING'
    )

    if (!playingTrack) {
      return res.status(500).json({ error: 'Failed to update track to PLAYING' })
    }

    // Update station state
    const newStationState = await updateStationState(supabaseAdmin, {
      current_track_id: playingTrack.id,
      current_started_at: new Date().toISOString()
    })

    if (!newStationState) {
      return res.status(500).json({ error: 'Failed to update station state' })
    }

    res.status(200).json({
      message: 'Station advanced successfully',
      advanced: true,
      current_track: playingTrack,
      playhead_seconds: 0,
      replay_created: replayCreated
    })
  } catch (error) {
    console.error('Advance station error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}