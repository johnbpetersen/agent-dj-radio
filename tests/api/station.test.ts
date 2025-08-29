import { describe, it, expect, beforeEach } from 'vitest'
import { testUtils } from '../../src/test/mocks/handlers'

describe('Station API Endpoints', () => {
  beforeEach(() => {
    testUtils.resetMockData()
  })

  describe('GET /api/station/state', () => {
    it('should return empty state when no tracks exist', async () => {
      const response = await fetch('/api/station/state')
      
      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.station_state.current_track_id).toBeNull()
      expect(result.station_state.current_track).toBeNull()
      expect(result.queue).toEqual([])
      expect(result.playhead_seconds).toBe(0)
    })

    it('should return queue tracks in correct status order', async () => {
      testUtils.addMockTrack({ status: 'DONE' }) // Should not appear in queue
      testUtils.addMockTrack({ status: 'READY' }) // Should appear
      testUtils.addMockTrack({ status: 'PAID' }) // Should appear  
      testUtils.addMockTrack({ status: 'GENERATING' }) // Should appear

      const response = await fetch('/api/station/state')
      const result = await response.json()

      expect(result.queue).toHaveLength(3)
      
      const statuses = result.queue.map((t: any) => t.status)
      expect(statuses).toContain('READY')
      expect(statuses).toContain('PAID')
      expect(statuses).toContain('GENERATING')
      expect(statuses).not.toContain('DONE')
    })

    it('should calculate playhead when track is playing', async () => {
      const track = testUtils.addMockTrack({ status: 'PLAYING' })
      testUtils.setCurrentTrack(track.id)

      // Mock current time to be 30 seconds after start
      const originalNow = Date.now
      const startTime = Date.now()
      global.Date.now = () => startTime + 30000

      try {
        const response = await fetch('/api/station/state')
        const result = await response.json()

        expect(result.station_state.current_track_id).toBe(track.id)
        expect(result.playhead_seconds).toBe(30)
      } finally {
        global.Date.now = originalNow
      }
    })

    it('should only accept GET method', async () => {
      const response = await fetch('/api/station/state', {
        method: 'POST'
      })

      expect(response.status).toBe(405)
    })
  })

  describe('POST /api/station/advance', () => {
    it('should advance to READY track when available', async () => {
      const readyTrack = testUtils.addMockTrack({ status: 'READY' })

      const response = await fetch('/api/station/advance', {
        method: 'POST'
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.advanced).toBe(true)
      expect(result.current_track.id).toBe(readyTrack.id)
      expect(result.current_track.status).toBe('PLAYING')
      expect(result.playhead_seconds).toBe(0)
    })

    it('should mark current track as DONE when advancing', async () => {
      const currentTrack = testUtils.addMockTrack({ 
        status: 'PLAYING',
        duration_seconds: 60 
      })
      const nextTrack = testUtils.addMockTrack({ status: 'READY' })
      testUtils.setCurrentTrack(currentTrack.id)

      // Mock time so current track has finished
      const originalNow = Date.now
      const startTime = Date.now()
      global.Date.now = () => startTime + 61000 // 61 seconds past start

      try {
        await fetch('/api/station/advance', { method: 'POST' })
      } finally {
        global.Date.now = originalNow
      }

      // Get updated state to verify current track was marked DONE
      const stateResponse = await fetch('/api/station/state')
      const state = await stateResponse.json()
      
      // Current track should now be the next track
      expect(state.station_state.current_track_id).toBe(nextTrack.id)
      
      // Previous track should be marked DONE (check via mock utils if needed)
      const tracks = testUtils.getMockTracks()
      const previousTrack = tracks.find(t => t.id === currentTrack.id)
      expect(previousTrack?.status).toBe('DONE')
    })

    it('should return no advance when current track still playing', async () => {
      const currentTrack = testUtils.addMockTrack({ 
        status: 'PLAYING',
        duration_seconds: 120 
      })
      testUtils.setCurrentTrack(currentTrack.id)

      // Mock time to be only 30 seconds into the track
      const originalNow = Date.now
      const startTime = Date.now()
      global.Date.now = () => startTime + 30000

      try {
        const response = await fetch('/api/station/advance', { method: 'POST' })
        const result = await response.json()

        expect(result.advanced).toBe(false)
        expect(result.current_track.id).toBe(currentTrack.id)
      } finally {
        global.Date.now = originalNow
      }
    })

    it('should clear station when no tracks available', async () => {
      // No tracks in the system
      const response = await fetch('/api/station/advance', { method: 'POST' })
      
      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.advanced).toBe(true)
      expect(result.current_track).toBeNull()
      expect(result.playhead_seconds).toBe(0)
    })

    it('should only accept POST method', async () => {
      const response = await fetch('/api/station/advance', {
        method: 'GET'
      })

      expect(response.status).toBe(405)
    })
  })
})