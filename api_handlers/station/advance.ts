import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { getStationState, updateStationState, getTracksByStatus, updateTrackStatus, createTrack } from '../../src/server/db.js'
import { selectNextTrack, createReplayTrack } from '../../src/server/selectors.js'
import { calculatePlayhead, isTrackFinished } from '../../src/server/station.js'
import { broadcastStationUpdate, broadcastTrackAdvance } from '../../src/server/realtime.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { handleApiError } from '../../src/lib/error-tracking.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'

async function advanceHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  // Accept both GET and POST (idempotent operation)
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  logger.cronJobStart('station/advance', { correlationId })

  try {
    // Get current station state
    const stationState = await getStationState(supabaseAdmin)
    if (!stationState) {
      throw new Error('Failed to get station state')
    }

    const currentTrack = stationState.current_track || null
    const playheadSeconds = calculatePlayhead(stationState)
    
    logger.info('Station advance check', {
      correlationId,
      currentTrackId: currentTrack?.id || null,
      playheadSeconds,
      trackFinished: currentTrack ? isTrackFinished(currentTrack, playheadSeconds) : null
    })
    
    // If current track is still playing, don't advance (idempotent behavior)
    if (currentTrack && !isTrackFinished(currentTrack, playheadSeconds)) {
      const duration = Date.now() - startTime
      logger.cronJobComplete('station/advance', duration, { 
        correlationId,
        advanced: false,
        reason: 'track_still_playing',
        currentTrackId: currentTrack.id
      })
      
      res.status(200).json({
        message: 'Current track still playing',
        advanced: false,
        current_track: currentTrack,
        playhead_seconds: playheadSeconds,
        correlationId
      })
      return
    }

    const previousTrackId = currentTrack?.id || null

    // Mark current track as DONE if it exists (idempotent operation)
    if (currentTrack) {
      await updateTrackStatus(
        supabaseAdmin,
        currentTrack.id,
        'DONE',
        { last_played_at: new Date().toISOString() }
      )
      
      logger.trackStatusChanged(currentTrack.id, 'PLAYING', 'DONE', { 
        correlationId,
        playheadSeconds
      })
    }

    // Get available tracks for selection
    const availableTracks = await getTracksByStatus(supabaseAdmin, ['READY', 'DONE'])
    
    // Filter out tracks with invalid audio_url (guard against missing/bad storage)
    const isPlayable = (t: any) => {
      if (!t?.audio_url || typeof t.audio_url !== 'string') return false;
      // must be .../tracks/{id}.mp3 exactly
      try {
        const last = t.audio_url.split('/').pop() || '';
        return last.toLowerCase() === `${String(t.id).toLowerCase()}.mp3`;
      } catch {
        return false;
      }
    };

    const readyTracks = availableTracks.filter(t => t.status === 'READY')
    const doneTracks = availableTracks.filter(t => t.status === 'DONE')
    const eligibleReadyTracks = readyTracks.filter(isPlayable)
    const eligibleDoneTracks = doneTracks.filter(isPlayable)
    
    logger.info('Available tracks for selection', {
      correlationId,
      readyTracks: readyTracks.length,
      eligibleReadyTracks: eligibleReadyTracks.length,
      doneTracks: doneTracks.length,
      eligibleDoneTracks: eligibleDoneTracks.length
    })
    
    // Select next track from eligible tracks only
    const eligibleAvailableTracks = [...eligibleReadyTracks, ...eligibleDoneTracks]
    let nextTrack = selectNextTrack(eligibleAvailableTracks)
    let replayCreated = null

    // If no eligible READY track, create a replay from best eligible DONE track
    if (!nextTrack) {
      if (eligibleDoneTracks.length > 0) {
        const bestReplay = selectNextTrack(eligibleDoneTracks) // This will pick the best replay candidate
        if (bestReplay) {
          const replayData = createReplayTrack(bestReplay)
          replayCreated = await createTrack(supabaseAdmin, replayData)
          nextTrack = replayCreated

          if (replayCreated) {
            logger.trackCreated(replayCreated.id, {
              correlationId,
              source: 'REPLAY',
              originalTrackId: bestReplay.id,
              prompt: replayData.prompt
            })
          }
        }
      }
    }

    if (!nextTrack) {
      logger.info('No eligible READY tracks with valid audio_url; falling back to replay/previous', { 
        correlationId,
        totalTracks: availableTracks.length,
        eligibleTracks: eligibleAvailableTracks.length
      })
      
      // No tracks available, clear station state (idempotent operation)
      const clearedState = await updateStationState(supabaseAdmin, {
        current_track_id: null,
        current_started_at: null
      })

      logger.info('Station cleared - no tracks available', { correlationId })

      // Broadcast station update
      if (clearedState) {
        await broadcastStationUpdate({
          stationState: clearedState,
          currentTrack: null
        })
      }

      const duration = Date.now() - startTime
      logger.cronJobComplete('station/advance', duration, { 
        correlationId,
        advanced: true,
        result: 'no_tracks'
      })

      res.status(200).json({
        message: 'No tracks available to play',
        advanced: true,
        current_track: null,
        playhead_seconds: 0,
        replay_created: null,
        correlationId
      })
      return
    }

    // Update track to PLAYING (idempotent - only one track can be PLAYING)
    const playingTrack = await updateTrackStatus(
      supabaseAdmin,
      nextTrack.id,
      'PLAYING'
    )

    if (!playingTrack) {
      throw new Error(`Failed to update track ${nextTrack.id} to PLAYING status`)
    }

    logger.trackStatusChanged(nextTrack.id, nextTrack.status, 'PLAYING', { 
      correlationId,
      wasReplay: nextTrack.source === 'REPLAY'
    })

    // Update station state (idempotent - sets current track)
    const newStationState = await updateStationState(supabaseAdmin, {
      current_track_id: playingTrack.id,
      current_started_at: new Date().toISOString()
    })

    if (!newStationState) {
      throw new Error('Failed to update station state')
    }

    logger.info('Station advanced successfully', {
      correlationId,
      previousTrackId,
      newTrackId: playingTrack.id,
      replayCreated: !!replayCreated
    })

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

    const duration = Date.now() - startTime
    logger.cronJobComplete('station/advance', duration, { 
      correlationId,
      advanced: true,
      result: 'success',
      newTrackId: playingTrack.id
    })

    res.status(200).json({
      message: 'Station advanced successfully',
      advanced: true,
      current_track: playingTrack,
      playhead_seconds: 0,
      replay_created: replayCreated,
      correlationId
    })
  } catch (error) {
    const duration = Date.now() - startTime
    const errorResponse = handleApiError(error, 'station/advance', { correlationId })
    
    logger.cronJobComplete('station/advance', duration, { 
      correlationId,
      advanced: false,
      result: 'error'
    })
    
    res.status(500).json(errorResponse)
  }
}

export default secureHandler(advanceHandler, securityConfigs.worker)