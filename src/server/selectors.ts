// Track selection logic for the station
// @ts-nocheck - TODO(types): Track type needs payer_user_id/submitter_user_id fields

import type { Track } from '../types'

export interface TrackWithScore extends Track {
  selection_score: number
}

/**
 * Selects the next track to play from available READY tracks
 * Priority: READY tracks > highest rated DONE tracks (replays)
 */
export function selectNextTrack(tracks: Track[]): Track | null {
  if (tracks.length === 0) return null

  // First priority: READY tracks (new submissions)
  const readyTracks = tracks.filter(track => track.status === 'READY')
  if (readyTracks.length > 0) {
    // Play READY tracks in creation order (FIFO)
    return readyTracks.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )[0]
  }

  // Second priority: DONE tracks for replay
  const doneTracks = tracks.filter(track => track.status === 'DONE')
  if (doneTracks.length === 0) return null

  return selectBestReplayTrack(doneTracks)
}

/**
 * Selects the best track for replay based on rating and recency
 */
export function selectBestReplayTrack(doneTracks: Track[]): Track | null {
  if (doneTracks.length === 0) return null

  // Score tracks based on rating and how long since last played
  const tracksWithScores: TrackWithScore[] = doneTracks.map(track => {
    let score = track.rating_score || 0

    // Boost score based on time since last played
    if (track.last_played_at) {
      const hoursSinceLastPlayed = 
        (Date.now() - new Date(track.last_played_at).getTime()) / (1000 * 60 * 60)
      // Add 0.1 points per hour since last played (max 2 points after 20 hours)
      score += Math.min(hoursSinceLastPlayed * 0.1, 2)
    } else {
      // Never played before gets a 1 point bonus
      score += 1
    }

    return {
      ...track,
      selection_score: score
    }
  })

  // Sort by selection score (highest first), then by rating_count as tiebreaker
  tracksWithScores.sort((a, b) => {
    if (b.selection_score !== a.selection_score) {
      return b.selection_score - a.selection_score
    }
    return (b.rating_count || 0) - (a.rating_count || 0)
  })

  return tracksWithScores[0]
}

/**
 * Creates a REPLAY track from an existing DONE track
 */
export function createReplayTrack(originalTrack: Track): Omit<Track, 'id' | 'created_at'> {
  return {
    user_id: originalTrack.user_id,
    prompt: originalTrack.prompt,
    duration_seconds: originalTrack.duration_seconds,
    source: 'REPLAY',
    status: 'READY',
    price_usd: 0, // Replays are free
    x402_payment_tx: null,
    eleven_request_id: originalTrack.eleven_request_id,
    audio_url: originalTrack.audio_url,
    rating_score: 0, // Reset rating for the replay instance
    rating_count: 0,
    last_played_at: null,
    started_at: null,
    finished_at: null
  }
}