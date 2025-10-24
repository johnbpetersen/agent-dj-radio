// Supabase Realtime broadcasting utilities
// @ts-nocheck - TODO(types): RealtimeChannelSendResponse type needs 'error' property

import { supabaseAdmin } from '../../api/_shared/supabase.js'
import type { StationState, Track } from '../types'

const STATION_CHANNEL = 'station'

export interface BroadcastStationUpdateParams {
  stationState: StationState
  currentTrack?: Track | null
}

/**
 * Broadcast station state updates to all connected clients
 */
export async function broadcastStationUpdate({ stationState, currentTrack }: BroadcastStationUpdateParams): Promise<void> {
  try {
    const payload = {
      type: 'station_update',
      current_track_id: stationState.current_track_id,
      current_started_at: stationState.current_started_at,
      updated_at: stationState.updated_at,
      current_track: currentTrack || null
    }

    const { error } = await supabaseAdmin
      .channel(STATION_CHANNEL)
      .send({
        type: 'broadcast',
        event: 'station_update',
        payload
      })

    if (error) {
      console.error('Failed to broadcast station update:', error)
      // Don't throw - realtime failures shouldn't break the flow
    } else {
      console.log('Station update broadcasted successfully')
    }
  } catch (error) {
    console.error('Error broadcasting station update:', error)
    // Don't throw - realtime failures shouldn't break the flow
  }
}

export interface BroadcastTrackAdvanceParams {
  previousTrackId: string | null
  newTrack: Track | null
  playheadSeconds: number
}

/**
 * Broadcast when station advances to a new track
 */
export async function broadcastTrackAdvance({ previousTrackId, newTrack, playheadSeconds }: BroadcastTrackAdvanceParams): Promise<void> {
  try {
    const payload = {
      type: 'track_advance',
      previous_track_id: previousTrackId,
      new_track: newTrack,
      playhead_seconds: playheadSeconds,
      timestamp: new Date().toISOString()
    }

    const { error } = await supabaseAdmin
      .channel(STATION_CHANNEL)
      .send({
        type: 'broadcast',
        event: 'track_advance',
        payload
      })

    if (error) {
      console.error('Failed to broadcast track advance:', error)
    } else {
      console.log('Track advance broadcasted successfully')
    }
  } catch (error) {
    console.error('Error broadcasting track advance:', error)
  }
}

export interface BroadcastQueueUpdateParams {
  queue: Track[]
  action: 'added' | 'updated' | 'removed'
  trackId: string
}

/**
 * Broadcast queue updates (new tracks, status changes)
 */
export async function broadcastQueueUpdate({ queue, action, trackId }: BroadcastQueueUpdateParams): Promise<void> {
  try {
    const payload = {
      type: 'queue_update',
      action,
      track_id: trackId,
      queue_length: queue.length,
      timestamp: new Date().toISOString()
    }

    const { error } = await supabaseAdmin
      .channel(STATION_CHANNEL)
      .send({
        type: 'broadcast',
        event: 'queue_update',
        payload
      })

    if (error) {
      console.error('Failed to broadcast queue update:', error)
    } else {
      console.log(`Queue update (${action}) broadcasted successfully`)
    }
  } catch (error) {
    console.error('Error broadcasting queue update:', error)
  }
}

/**
 * Get the station channel name for client subscriptions
 */
export function getStationChannelName(): string {
  return STATION_CHANNEL
}