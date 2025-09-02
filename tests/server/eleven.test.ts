import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTrack, pollTrack, pollTrackWithTimeout, fetchToBuffer } from '../../src/server/eleven'

// Mock dependencies
vi.mock('../../src/lib/logger')
vi.mock('../../src/lib/error-tracking')

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('ElevenLabs Integration with Enhanced Rate Limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set environment variables
    process.env.ELEVEN_API_KEY = 'test-api-key'
    process.env.ELEVEN_MUSIC_MODEL_ID = 'test-model'
    process.env.NODE_ENV = 'test'
  })

  describe('createTrack with enhanced features', () => {
    it('should create track with valid parameters and enhanced logging', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ request_id: 'test-request-123' })
      }
      mockFetch.mockResolvedValue(mockResponse as Response)

      const params = {
        prompt: 'A happy upbeat song',
        durationSeconds: 120
      }

      const result = await createTrack(params)

      expect(result.requestId).toBe('test-request-123')
      expect(fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/music/generation',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'xi-api-key': 'test-api-key',
            'User-Agent': 'Agent-DJ-Radio/1.0'
          }),
          body: JSON.stringify({
            text: 'A happy upbeat song',
            model_id: 'test-model',
            duration: 120
          }),
          signal: expect.any(AbortSignal)
        })
      )
    })

    it('should retry on rate limit errors (429)', async () => {
      // Mock rate limit error then success
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => 'Rate limit exceeded'
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ request_id: 'retry-success-123' })
        } as Response)

      const params = {
        prompt: 'Retry test song',
        durationSeconds: 60
      }

      const result = await createTrack(params)

      expect(result.requestId).toBe('retry-success-123')
      expect(mockFetch).toHaveBeenCalledTimes(2) // Should retry once
    }, 10000) // Extended timeout for retry logic

    it('should retry on 5xx server errors', async () => {
      // Mock server error then success
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal server error'
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ request_id: 'server-error-retry-123' })
        } as Response)

      const params = {
        prompt: 'Server error test song',
        durationSeconds: 90
      }

      const result = await createTrack(params)

      expect(result.requestId).toBe('server-error-retry-123')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    }, 10000)

    it('should not retry on 4xx client errors (except 429)', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        text: async () => 'Bad request'
      }
      mockFetch.mockResolvedValue(mockResponse as Response)

      const params = {
        prompt: 'Test song',
        durationSeconds: 60
      }

      await expect(createTrack(params)).rejects.toThrow('ElevenLabs API error: 400')
      expect(mockFetch).toHaveBeenCalledTimes(1) // Should not retry
    })

    it('should reject invalid durations', async () => {
      const params = {
        prompt: 'Test song',
        durationSeconds: 75 // Invalid
      }

      await expect(createTrack(params)).rejects.toThrow('Invalid duration')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should reject empty prompts', async () => {
      const params = {
        prompt: '',
        durationSeconds: 60
      }

      await expect(createTrack(params)).rejects.toThrow('Prompt cannot be empty')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should reject prompts that are too long', async () => {
      const params = {
        prompt: 'a'.repeat(501), // Too long
        durationSeconds: 60
      }

      await expect(createTrack(params)).rejects.toThrow('Prompt too long')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should throw error when API key not configured', async () => {
      delete process.env.ELEVEN_API_KEY

      const params = {
        prompt: 'Test song',
        durationSeconds: 60
      }

      await expect(createTrack(params)).rejects.toThrow('ElevenLabs API key not configured')
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