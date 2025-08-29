// Station state management logic

import type { Track, StationState } from '../types'

export interface AdvanceResult {
  newTrack: Track | null
  replayCreated?: Track
  playheadSeconds: number
}

/**
 * Calculates current playhead position based on station state
 */
export function calculatePlayhead(stationState: StationState): number {
  if (!stationState.current_track_id || !stationState.current_started_at) {
    return 0
  }

  const startedAt = new Date(stationState.current_started_at).getTime()
  const now = Date.now()
  const elapsedMs = now - startedAt
  
  return Math.max(0, Math.floor(elapsedMs / 1000))
}

/**
 * Determines if current track has finished playing
 */
export function isTrackFinished(track: Track | null, playheadSeconds: number): boolean {
  if (!track) return true
  return playheadSeconds >= track.duration_seconds
}

/**
 * Gets station status summary
 */
export function getStationStatus(
  stationState: StationState, 
  currentTrack: Track | null,
  queue: Track[]
): {
  status: 'playing' | 'idle' | 'between_tracks'
  playheadSeconds: number
  queueSize: number
  isTrackFinished: boolean
} {
  const playheadSeconds = calculatePlayhead(stationState)
  const trackFinished = isTrackFinished(currentTrack, playheadSeconds)
  
  let status: 'playing' | 'idle' | 'between_tracks' = 'idle'
  
  if (currentTrack && !trackFinished) {
    status = 'playing'
  } else if (queue.length > 0) {
    status = 'between_tracks'
  }

  return {
    status,
    playheadSeconds,
    queueSize: queue.length,
    isTrackFinished: trackFinished
  }
}