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
      user:users!tracks_submitter_user_id_fkey (*)
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
 * Claim next PAID track with concurrency control
 */
export async function claimNextPaidTrack(supabase: SupabaseClient): Promise<Track | null> {
  try {
    // Use FOR UPDATE SKIP LOCKED for safe concurrent processing
    const { data, error } = await supabase.rpc('claim_next_paid_track')
    
    if (error) {
      console.error('Error claiming paid track:', error)
      return null
    }
    
    if (!data || data.length === 0) {
      return null
    }
    
    return data[0] as Track
  } catch (error) {
    console.error('Error in claim operation:', error)
    return null
  }
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
      user:users!tracks_submitter_user_id_fkey (*)
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
      user:users!tracks_submitter_user_id_fkey (*)
    `)
    .single()

  if (error || !data) {
    console.error('Error creating track:', error)
    return null
  }

  return data as Track
}

/**
 * Get track by ID
 */
export async function getTrackById(
  supabase: SupabaseClient,
  trackId: string
): Promise<Track | null> {
  const { data, error } = await supabase
    .from('tracks')
    .select(`
      *,
      user:users!tracks_submitter_user_id_fkey (*)
    `)
    .eq('id', trackId)
    .single()

  if (error || !data) {
    console.error('Error fetching track by ID:', error)
    return null
  }

  return data as Track
}

/**
 * Update track payment status with x402 proof
 */
export async function confirmTrackPayment(
  supabase: SupabaseClient,
  trackId: string,
  paymentProof: any
): Promise<Track | null> {
  const { data, error } = await supabase
    .from('tracks')
    .update({
      status: 'PAID',
      x402_payment_tx: paymentProof
    })
    .eq('id', trackId)
    .select(`
      *,
      user:users!tracks_submitter_user_id_fkey (*)
    `)
    .single()

  if (error || !data) {
    console.error('Error confirming track payment:', error)
    return null
  }

  return data as Track
}

/**
 * Get or create user by display name
 */
export async function upsertUser(
  supabase: SupabaseClient,
  userData: {
    display_name: string
    banned?: boolean
  }
): Promise<any> {
  const name = userData.display_name.trim()
  if (!name) return null

  // Exact, case-insensitive match without wildcard risk
  const { data: existing, error: findErr } = await supabase
    .from('users')
    .select('*')
    .filter('display_name', 'ilike', name) // matches exactly if no %/_ in input
    .limit(1)
    .maybeSingle()

  if (findErr) {
    console.error('Find user error:', findErr)
    return null
  }
  if (existing) return existing

  // Create with generated id (works regardless of DB default)
  const id = (globalThis as any).crypto?.randomUUID?.() ?? require('node:crypto').randomUUID()
  const { data, error } = await supabase
    .from('users')
    .insert({
      id,
      display_name: name,
      banned: userData.banned ?? false
    })
    .select()
    .single()

  if (error) {
    console.error('Create user error:', error)
    return null
  }
  return data
}

/**
 * Update user last submit time for rate limiting
 */
export async function updateUserLastSubmit(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({
      last_submit_at: new Date().toISOString()
    })
    .eq('id', userId)

  if (error) {
    console.error('Error updating user last submit:', error)
    return false
  }

  return true
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
    const kind = reaction.kind as ReactionKind
    acc[kind] = (acc[kind] || 0) + 1
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
      user:users!tracks_submitter_user_id_fkey (*)
    `)
    .single()

  if (error || !data) {
    console.error('Error updating track rating:', error)
    return null
  }

  return data as Track
}