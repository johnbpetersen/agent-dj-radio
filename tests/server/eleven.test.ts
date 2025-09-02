import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTrack, pollTrack, pollTrackWithTimeout, fetchToBuffer } from '../../src/server/eleven'
import type { CreateTrackParams, PollTrackParams } from '../../src/types'

// Mock environment variables
vi.mock('process.env', () => ({
  ELEVEN_API_KEY: 'test-api-key',
  ELEVEN_BASE_URL: 'https://api.elevenlabs.io/v1',
  ELEVEN_MUSIC_MODEL_ID: 'test-model'
}))

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('ElevenLabs Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set environment variables
    process.env.ELEVEN_API_KEY = 'test-api-key'
    process.env.ELEVEN_BASE_URL = 'https://api.elevenlabs.io/v1'
    process.env.ELEVEN_MUSIC_MODEL_ID = 'test-model'
  })

  describe('createTrack', () => {
    it('should create track with valid parameters', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ request_id: 'test-request-123' })
      }
      mockFetch.mockResolvedValue(mockResponse as Response)

      const params: CreateTrackParams = {
        prompt: 'A happy upbeat song',
        durationSeconds: 120
      }

      const result = await createTrack(params)

      expect(result.requestId).toBe('test-request-123')
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/music/generation'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            text: 'A happy upbeat song',
            model_id: expect.any(String),
            duration: 120
          })
        })
      )
    })

    it('should reject invalid durations', async () => {
      const params: CreateTrackParams = {
        prompt: 'Test song',
        durationSeconds: 75 // Invalid
      }

      await expect(createTrack(params)).rejects.toThrow('Invalid duration')
    })

    it('should handle API errors', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        text: async () => 'Invalid request'
      }
      mockFetch.mockResolvedValue(mockResponse as Response)

      const params: CreateTrackParams = {
        prompt: 'Test song',
        durationSeconds: 60
      }

      await expect(createTrack(params)).rejects.toThrow()
    })
  })

  describe('pollTrack', () => {
    it('should return completed track status', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          status: 'completed',
          audio_url: 'https://example.com/audio.mp3'
        })
      }
      mockFetch.mockResolvedValue(mockResponse as Response)

      const params: PollTrackParams = {
        requestId: 'test-request-123'
      }

      const result = await pollTrack(params)

      expect(result.status).toBe('completed')
      expect(result.audioUrl).toBe('https://example.com/audio.mp3')
    })

    it('should return pending status', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          status: 'pending'
        })
      }
      mockFetch.mockResolvedValue(mockResponse as Response)

      const params: PollTrackParams = {
        requestId: 'test-request-123'
      }

      const result = await pollTrack(params)

      expect(result.status).toBe('pending')
      expect(result.audioUrl).toBeNull()
    })
  })

  describe('pollTrackWithTimeout', () => {
    it('should complete successfully within timeout', async () => {
      // Mock successful completion on second poll
      const mockPendingResponse = {
        ok: true,
        json: async () => ({ status: 'pending' })
      }
      const mockCompletedResponse = {
        ok: true,
        json: async () => ({
          status: 'completed',
          audio_url: 'https://example.com/audio.mp3'
        })
      }

      mockFetch
        .mockResolvedValueOnce(mockPendingResponse as Response)
        .mockResolvedValueOnce(mockCompletedResponse as Response)

      const params: PollTrackParams = {
        requestId: 'test-request-123'
      }

      const result = await pollTrackWithTimeout(params, 1000) // 1 second timeout

      expect(result.status).toBe('completed')
      expect(result.audioUrl).toBe('https://example.com/audio.mp3')
    })

    it('should timeout if track not completed in time', async () => {
      const mockPendingResponse = {
        ok: true,
        json: async () => ({ status: 'pending' })
      }
      vi.mocked(fetch).mockResolvedValue(mockPendingResponse as Response)

      const params: PollTrackParams = {
        requestId: 'test-request-123'
      }

      const result = await pollTrackWithTimeout(params, 100) // Very short timeout

      expect(result.status).toBe('failed')
      expect(result.error).toContain('timeout')
    })
  })

  describe('fetchToBuffer', () => {
    it('should fetch audio data as buffer', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      const mockResponse = {
        ok: true,
        arrayBuffer: async () => mockArrayBuffer
      }
      mockFetch.mockResolvedValue(mockResponse as Response)

      const result = await fetchToBuffer('https://example.com/audio.mp3')

      expect(result).toBeInstanceOf(Buffer)
      expect(result.length).toBe(1024)
    })

    it('should handle fetch errors', async () => {
      const mockResponse = {
        ok: false,
        status: 404
      }
      mockFetch.mockResolvedValue(mockResponse as Response)

      await expect(fetchToBuffer('https://example.com/invalid.mp3'))
        .rejects.toThrow()
    })
  })
})