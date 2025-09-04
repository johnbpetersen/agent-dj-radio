import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { StationData, StationStateResponse } from '../types'

const POLL_INTERVAL = 5000 // 5 seconds

export function useStation() {
  const [stationData, setStationData] = useState<StationData>({
    currentTrack: null,
    playheadSeconds: 0,
    queue: [],
    isLoading: true,
    error: null
  })

  const fetchStationState = useCallback(async () => {
    try {
      const response = await fetch('/api/station/state')
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      
      const data: StationStateResponse = await response.json()
      
      setStationData(prev => ({
        ...prev,
        currentTrack: data.station_state.current_track || null,
        playheadSeconds: data.playhead_seconds || 0,
        queue: data.queue,
        isLoading: false,
        error: null
      }))
    } catch (error) {
      console.error('Failed to fetch station state:', error)
      setStationData(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    }
  }, [])

  const advanceStation = useCallback(async () => {
    try {
      const response = await fetch('/api/station/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      
      // Immediately refetch state after advancing
      await fetchStationState()
    } catch (error) {
      console.error('Failed to advance station:', error)
      setStationData(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to advance station'
      }))
    }
  }, [fetchStationState])

  // Initial fetch
  useEffect(() => {
    fetchStationState()
  }, [fetchStationState])

  // Polling (fallback for real-time updates)
  useEffect(() => {
    const interval = setInterval(fetchStationState, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchStationState])

  // Auto-advance logic: advance station when no track is playing but queue has ready tracks
  useEffect(() => {
    const { currentTrack, queue, isLoading, playheadSeconds } = stationData
    
    // Skip if still loading
    if (isLoading) return
    
    // Case 1: No current track but READY tracks available
    if (!currentTrack) {
      const readyTracks = queue.filter(track => track.status === 'READY')
      if (readyTracks.length > 0) {
        console.log('No current track playing but READY tracks found, auto-advancing station...')
        advanceStation()
      }
      return
    }

    // Case 2: Current track has finished playing (server-side check)
    if (currentTrack && playheadSeconds >= currentTrack.duration_seconds) {
      console.log('Current track finished on server, auto-advancing station...', {
        trackId: currentTrack.id,
        playheadSeconds,
        duration: currentTrack.duration_seconds
      })
      advanceStation()
    }
  }, [stationData, advanceStation])

  // Real-time subscriptions
  useEffect(() => {
    const channel = supabase
      .channel('station')
      .on('broadcast', { event: 'station_update' }, (payload) => {
        console.log('Received station update:', payload)
        // Refetch state when station updates
        fetchStationState()
      })
      .on('broadcast', { event: 'track_advance' }, (payload) => {
        console.log('Received track advance:', payload)
        // Immediately update with new track data
        fetchStationState()
      })
      .on('broadcast', { event: 'queue_update' }, (payload) => {
        console.log('Received queue update:', payload)
        // Refetch to get updated queue
        fetchStationState()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchStationState])

  return {
    ...stationData,
    refetch: fetchStationState,
    advanceStation
  }
}