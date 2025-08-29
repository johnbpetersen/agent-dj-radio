// Database operations and utilities

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Track, Reaction, StationState, ReactionKind } from '../types'

/**
 * Fetch station state with current track
 */
export async function getStationState(supabase: SupabaseClient): Promise<StationState | null> {
  const { data, error } = await supabase
    .from('station_state')
    .select(`
      *,
      current_track:tracks(*)
    `)
    .eq('id', 1)
    .single()

  if (error || !data) {
    console.error('Error fetching station state:', error)
    return null
  }

  return data as StationState
}

/**
 * Update station state
 */
export async function updateStationState(
  supabase: SupabaseClient,
  updates: {
    current_track_id?: string | null
    current_started_at?: string | null
  }
): Promise<StationState | null> {
  const { data, error } = await supabase
    .from('station_state')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', 1)
    .select()
    .single()

  if (error || !data) {
    console.error('Error updating station state:', error)
    return null
  }

  return data as StationState
}

/**
 * Get tracks by status with user information
 */
export async function getTracksByStatus(
  supabase: SupabaseClient, 
  statuses: string[]
): Promise<Track[]> {
  const { data, error } = await supabase
    .from('tracks')
    .select(`
      *,
      user:users(*)
    `)
    .in('status', statuses)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching tracks:', error)
    return []
  }

  return data as Track[]
}

/**
 * Update track status
 */
export async function updateTrackStatus(
  supabase: SupabaseClient,
  trackId: string,
  status: string,
  additionalUpdates: Partial<Track> = {}
): Promise<Track | null> {
  const updates = {
    status,
    ...additionalUpdates,
    ...(status === 'PLAYING' && { started_at: new Date().toISOString() }),
    ...(status === 'DONE' && { finished_at: new Date().toISOString() })
  }

  const { data, error } = await supabase
    .from('tracks')
    .update(updates)
    .eq('id', trackId)
    .select(`
      *,
      user:users(*)
    `)
    .single()

  if (error || !data) {
    console.error('Error updating track status:', error)
    return null
  }

  return data as Track
}

/**
 * Create a new track
 */
export async function createTrack(
  supabase: SupabaseClient,
  trackData: Omit<Track, 'id' | 'created_at' | 'user'>
): Promise<Track | null> {
  const { data, error } = await supabase
    .from('tracks')
    .insert(trackData)
    .select(`
      *,
      user:users(*)
    `)
    .single()

  if (error || !data) {
    console.error('Error creating track:', error)
    return null
  }

  return data as Track
}

/**
 * Add or update a reaction
 */
export async function upsertReaction(
  supabase: SupabaseClient,
  trackId: string,
  userId: string,
  kind: ReactionKind
): Promise<Reaction | null> {
  const { data, error } = await supabase
    .from('reactions')
    .upsert({
      track_id: trackId,
      user_id: userId,
      kind
    })
    .select()
    .single()

  if (error || !data) {
    console.error('Error upserting reaction:', error)
    return null
  }

  return data as Reaction
}

/**
 * Recompute and update track rating
 */
export async function updateTrackRating(
  supabase: SupabaseClient,
  trackId: string
): Promise<Track | null> {
  // Get all reactions for this track
  const { data: reactions, error: reactionsError } = await supabase
    .from('reactions')
    .select('kind')
    .eq('track_id', trackId)

  if (reactionsError) {
    console.error('Error fetching reactions:', reactionsError)
    return null
  }

  // Calculate rating score
  const reactionCounts = reactions.reduce((acc, reaction) => {
    acc[reaction.kind] = (acc[reaction.kind] || 0) + 1
    return acc
  }, {} as Record<ReactionKind, number>)

  const loveCount = reactionCounts.LOVE || 0
  const fireCount = reactionCounts.FIRE || 0
  const skipCount = reactionCounts.SKIP || 0
  const totalCount = loveCount + fireCount + skipCount

  // Rating algorithm: Love = 2 points, Fire = 1 point, Skip = -1 point
  const rawScore = (loveCount * 2) + (fireCount * 1) + (skipCount * -1)
  const ratingScore = totalCount > 0 ? Number((rawScore / totalCount).toFixed(2)) : 0

  // Update track with new rating
  const { data, error } = await supabase
    .from('tracks')
    .update({
      rating_score: ratingScore,
      rating_count: totalCount
    })
    .eq('id', trackId)
    .select(`
      *,
      user:users(*)
    `)
    .single()

  if (error || !data) {
    console.error('Error updating track rating:', error)
    return null
  }

  return data as Track
}