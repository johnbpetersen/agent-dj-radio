import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdminAuth } from '../_shared/admin-auth.js'
import { supabaseAdmin } from '../_shared/supabase.js'
import { getStationState, updateStationState, getTracksByStatus, updateTrackStatus, createTrack } from '../../src/server/db.js'
import { selectNextTrack, createReplayTrack } from '../../src/server/selectors.js'
import { calculatePlayhead } from '../../src/server/station.js'
import { broadcastStationUpdate, broadcastTrackAdvance } from '../../src/server/realtime.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Admin authentication
  const authError = requireAdminAuth(req)
  if (authError === 'NOT_FOUND') {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (authError) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    // Get current station state
    const stationState = await getStationState(supabaseAdmin)
    if (!stationState) {
      res.status(500).json({ error: 'Failed to get station state' })
      return
    }

    const currentTrack = stationState.current_track || null
    const _playheadSeconds = calculatePlayhead(stationState)
    
    console.log(`Admin: Advancing station - current track: ${currentTrack?.id || 'none'}`)

    const previousTrackId = currentTrack?.id || null

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
      const clearedState = await updateStationState(supabaseAdmin, {
        current_track_id: null,
        current_started_at: null
      })

      // Broadcast station update
      if (clearedState) {
        await broadcastStationUpdate({
          stationState: clearedState,
          currentTrack: null
        })
      }

      res.status(200).json({
        message: 'No tracks available to play',
        advanced: true,
        current_track: null,
        playhead_seconds: 0,
        replay_created: null
      })
      return
    }

    // Update track to PLAYING
    const playingTrack = await updateTrackStatus(
      supabaseAdmin,
      nextTrack.id,
      'PLAYING'
    )

    if (!playingTrack) {
      res.status(500).json({ error: 'Failed to update track to PLAYING' })
      return
    }

    // Update station state
    const newStationState = await updateStationState(supabaseAdmin, {
      current_track_id: playingTrack.id,
      current_started_at: new Date().toISOString()
    })

    if (!newStationState) {
      res.status(500).json({ error: 'Failed to update station state' })
      return
    }

    // Broadcast station update
    await broadcastStationUpdate({
      stationState: newStationState,
      currentTrack: playingTrack
    })

    // Broadcast track advance
    await broadcastTrackAdvance({
      previousTrackId,
      newTrack: playingTrack,
      playheadSeconds: 0
    })

    console.log(`Admin: Station advanced to track ${playingTrack.id}`)

    res.status(200).json({
      message: 'Station advanced successfully',
      advanced: true,
      current_track: playingTrack,
      playhead_seconds: 0,
      replay_created: replayCreated
    })
  } catch (error) {
    console.error('Admin advance station error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}