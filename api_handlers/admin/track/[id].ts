import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdminAuth } from '../../_shared/admin-auth.js'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { getTrackById, updateTrackStatus, getStationState } from '../../../src/server/db.js'
import { broadcastQueueUpdate, broadcastStationUpdate } from '../../../src/server/realtime.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
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

  const trackId = req.query.id as string
  if (!trackId) {
    res.status(400).json({ error: 'Track ID required' })
    return
  }

  try {
    // Get track to verify it exists
    const track = await getTrackById(supabaseAdmin, trackId)
    if (!track) {
      res.status(404).json({ error: 'Track not found' })
      return
    }

    if (req.method === 'DELETE') {
      // Hard delete track
      const { error } = await supabaseAdmin
        .from('tracks')
        .delete()
        .eq('id', trackId)

      if (error) {
        console.error('Admin delete track error:', error)
        res.status(500).json({ error: 'Failed to delete track' })
        return
      }

      // Broadcast queue update to remove from UI
      await broadcastQueueUpdate({
        queue: [],
        action: 'deleted',
        trackId: trackId
      })

      console.log(`Admin: Deleted track ${trackId}`)

      res.status(200).json({
        message: 'Track deleted successfully',
        track_id: trackId
      })
      return
    }

    if (req.method === 'POST') {
      const { action } = req.body

      if (!action || (action !== 'skip' && action !== 'requeue')) {
        res.status(400).json({
          error: 'Invalid action. Must be "skip" or "requeue"'
        })
        return
      }

      if (action === 'skip') {
        // Skip: mark track as DONE
        if (track.status === 'DONE') {
          res.status(400).json({ error: 'Track is already done' })
          return
        }

        const skippedTrack = await updateTrackStatus(
          supabaseAdmin,
          trackId,
          'DONE',
          { last_played_at: new Date().toISOString() }
        )

        if (!skippedTrack) {
          res.status(500).json({ error: 'Failed to skip track' })
          return
        }

        // If this was the currently playing track, update station state
        const stationState = await getStationState(supabaseAdmin)
        if (stationState?.current_track?.id === trackId) {
          // Clear current track from station
          const { error: stationError } = await supabaseAdmin
            .from('station_state')
            .update({
              current_track_id: null,
              current_started_at: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', 1)

          if (!stationError) {
            // Broadcast station update
            await broadcastStationUpdate({
              stationState: { ...stationState, current_track: null, current_track_id: null },
              currentTrack: null
            })
          }
        }

        // Broadcast queue update
        await broadcastQueueUpdate({
          queue: [skippedTrack],
          action: 'updated',
          trackId: skippedTrack.id
        })

        console.log(`Admin: Skipped track ${trackId}`)

        res.status(200).json({
          message: 'Track skipped successfully',
          track: skippedTrack
        })
        return
      }

      if (action === 'requeue') {
        // Requeue: change DONE/FAILED back to READY
        if (track.status !== 'DONE' && track.status !== 'FAILED') {
          res.status(400).json({
            error: 'Can only requeue DONE or FAILED tracks'
          })
          return
        }

        const requeuedTrack = await updateTrackStatus(
          supabaseAdmin,
          trackId,
          'READY',
          { 
            last_played_at: null,
            finished_at: null 
          }
        )

        if (!requeuedTrack) {
          res.status(500).json({ error: 'Failed to requeue track' })
          return
        }

        // Broadcast queue update
        await broadcastQueueUpdate({
          queue: [requeuedTrack],
          action: 'updated',
          trackId: requeuedTrack.id
        })

        console.log(`Admin: Requeued track ${trackId}`)

        res.status(200).json({
          message: 'Track requeued successfully',
          track: requeuedTrack
        })
        return
      }
    }

    res.status(400).json({ error: 'Invalid request' })

  } catch (error) {
    console.error('Admin track operation error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}