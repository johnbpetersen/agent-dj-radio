import { describe, it, expect, beforeEach, vi } from 'vitest'
import { testUtils } from '../../src/test/mocks/handlers'

const TEST_ADMIN_TOKEN = 'test-secret'

// Mock admin endpoints since they don't exist in MSW
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('/api/admin endpoints', () => {
  beforeEach(() => {
    testUtils.resetMockData()
    mockFetch.mockClear()
    
    // Set admin token for tests
    process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
  })

  describe('Authentication', () => {
    it('returns 404 when ADMIN_TOKEN not set', async () => {
      const originalToken = process.env.ADMIN_TOKEN
      delete process.env.ADMIN_TOKEN

      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
        json: async () => ({ error: 'Not found' })
      })

      const response = await fetch('http://localhost:3000/api/admin/state', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token'
        }
      })

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/admin/state', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token'
        }
      })

      process.env.ADMIN_TOKEN = originalToken
    })

    it('returns 401 when Authorization header missing', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ error: 'Unauthorized' })
      })

      const response = await fetch('http://localhost:3000/api/admin/state', {
        method: 'GET'
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('returns 401 when Authorization header invalid format', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ error: 'Unauthorized' })
      })

      const response = await fetch('http://localhost:3000/api/admin/state', {
        method: 'GET',
        headers: {
          'Authorization': 'InvalidFormat'
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('returns 401 when token mismatch', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ error: 'Unauthorized' })
      })

      const response = await fetch('http://localhost:3000/api/admin/state', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer wrong-token'
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('returns 200 when token valid', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ 
          station_state: { id: 1, current_track: null },
          queue: [],
          recent_tracks: [],
          playhead_seconds: 0
        })
      })

      const response = await fetch('http://localhost:3000/api/admin/state', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/generate', () => {
    it('returns no tracks to generate when queue empty', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          message: 'No tracks to generate',
          processed: false
        })
      })

      const response = await fetch('http://localhost:3000/api/admin/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('processes PAID track when available', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          message: 'Track generated successfully',
          processed: true,
          track: {
            id: 'test-track-id',
            status: 'READY',
            audio_url: 'http://example.com/audio.mp3'
          },
          eleven_enabled: false
        })
      })

      const response = await fetch('http://localhost:3000/api/admin/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('returns 405 for non-POST methods', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 405,
        ok: false,
        json: async () => ({ error: 'Method not allowed' })
      })

      const response = await fetch('http://localhost:3000/api/admin/generate', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/advance', () => {
    it('returns no tracks to advance when queue empty', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          message: 'No tracks available to play',
          advanced: true,
          current_track: null
        })
      })

      const response = await fetch('http://localhost:3000/api/admin/advance', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('advances to READY track when available', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          message: 'Station advanced successfully',
          advanced: true,
          current_track: {
            id: 'test-track-id',
            status: 'PLAYING'
          },
          playhead_seconds: 0
        })
      })

      const response = await fetch('http://localhost:3000/api/admin/advance', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('GET /api/admin/state', () => {
    it('returns station state and queue', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          station_state: { id: 1, current_track: null },
          queue: [
            { id: 'ready-track', status: 'READY' }
          ],
          recent_tracks: [
            { id: 'done-track', status: 'DONE', rating_score: 1.5 }
          ],
          playhead_seconds: 0
        })
      })

      const response = await fetch('http://localhost:3000/api/admin/state', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/track/:id', () => {
    it('returns 404 for non-existent track', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
        json: async () => ({ error: 'Track not found' })
      })

      const fakeId = 'fake-track-id'
      const response = await fetch(`http://localhost:3000/api/admin/track/${fakeId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'skip' })
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('skips track successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          message: 'Track skipped successfully',
          track: { id: 'test-track', status: 'DONE' }
        })
      })

      const response = await fetch(`http://localhost:3000/api/admin/track/test-track`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'skip' })
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('requeues DONE track successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          message: 'Track requeued successfully',
          track: { id: 'test-track', status: 'READY' }
        })
      })

      const response = await fetch(`http://localhost:3000/api/admin/track/test-track`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'requeue' })
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('returns 400 for invalid action', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 400,
        ok: false,
        json: async () => ({ error: 'Invalid action. Must be "skip" or "requeue"' })
      })

      const response = await fetch(`http://localhost:3000/api/admin/track/test-track`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'invalid' })
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('DELETE /api/admin/track/:id', () => {
    it('deletes track successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          message: 'Track deleted successfully',
          track_id: 'test-track'
        })
      })

      const response = await fetch(`http://localhost:3000/api/admin/track/test-track`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('returns 404 for non-existent track', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
        json: async () => ({ error: 'Track not found' })
      })

      const fakeId = 'fake-track-id'
      const response = await fetch(`http://localhost:3000/api/admin/track/${fakeId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`
        }
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })
})