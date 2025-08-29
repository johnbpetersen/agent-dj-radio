import { useState, useEffect, useCallback } from 'react'
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

  // Polling
  useEffect(() => {
    const interval = setInterval(fetchStationState, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchStationState])

  return {
    ...stationData,
    refetch: fetchStationState,
    advanceStation
  }
}