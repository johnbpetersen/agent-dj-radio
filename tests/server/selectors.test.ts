import { describe, it, expect, beforeEach } from 'vitest'
import { selectNextTrack, selectBestReplayTrack, createReplayTrack } from '../../src/server/selectors'
import type { Track } from '../../src/types'

describe('Track Selection Logic', () => {
  let mockTracks: Track[]

  beforeEach(() => {
    const baseTrack = {
      user_id: 'user-1',
      prompt: 'Test track',
      duration_seconds: 120,
      price_usd: 5.40,
      x402_payment_tx: null,
      eleven_request_id: null,
      audio_url: '/sample-track.mp3',
      rating_score: 0,
      rating_count: 0,
      last_played_at: null,
      started_at: null,
      finished_at: null
    }

    mockTracks = [
      {
        ...baseTrack,
        id: 'track-1',
        source: 'GENERATED' as const,
        status: 'READY' as const,
        created_at: '2024-01-01T10:00:00Z'
      },
      {
        ...baseTrack,
        id: 'track-2', 
        source: 'GENERATED' as const,
        status: 'READY' as const,
        created_at: '2024-01-01T11:00:00Z'
      },
      {
        ...baseTrack,
        id: 'track-3',
        source: 'GENERATED' as const,
        status: 'DONE' as const,
        created_at: '2024-01-01T09:00:00Z',
        rating_score: 1.5,
        rating_count: 10,
        last_played_at: '2024-01-01T12:00:00Z'
      },
      {
        ...baseTrack,
        id: 'track-4',
        source: 'GENERATED' as const,
        status: 'DONE' as const, 
        created_at: '2024-01-01T08:00:00Z',
        rating_score: 1.8,
        rating_count: 5,
        last_played_at: null // Never played
      }
    ]
  })

  describe('selectNextTrack', () => {
    it('should return null for empty array', () => {
      expect(selectNextTrack([])).toBeNull()
    })

    it('should prioritize READY tracks over DONE tracks', () => {
      const selected = selectNextTrack(mockTracks)
      expect(selected).not.toBeNull()
      expect(selected?.status).toBe('READY')
    })

    it('should select oldest READY track first (FIFO)', () => {
      const readyTracks = mockTracks.filter(t => t.status === 'READY')
      const selected = selectNextTrack(mockTracks)
      
      expect(selected?.id).toBe('track-1') // Oldest READY track
      expect(selected?.created_at).toBe('2024-01-01T10:00:00Z')
    })

    it('should select best DONE track when no READY tracks available', () => {
      const doneTracks = mockTracks.filter(t => t.status === 'DONE')
      const selected = selectNextTrack(doneTracks)
      
      expect(selected).not.toBeNull()
      expect(selected?.status).toBe('DONE')
    })

    it('should return null when no READY or DONE tracks available', () => {
      const otherTracks = mockTracks.map(t => ({ ...t, status: 'PAID' as const }))
      const selected = selectNextTrack(otherTracks)
      
      expect(selected).toBeNull()
    })
  })

  describe('selectBestReplayTrack', () => {
    it('should return null for empty array', () => {
      expect(selectBestReplayTrack([])).toBeNull()
    })

    it('should prefer track that has never been played', () => {
      // Mock current time to be just 1 hour after track-3 was played
      const originalNow = Date.now
      const oneHourLater = new Date('2024-01-01T13:00:00Z').getTime()
      global.Date.now = () => oneHourLater

      try {
        const doneTracks = mockTracks.filter(t => t.status === 'DONE')
        const selected = selectBestReplayTrack(doneTracks)
        
        // track-4: rating 1.8 + 1.0 never played bonus = 2.8
        // track-3: rating 1.5 + 0.1 time bonus (1 hour) = 1.6
        // track-4 should win
        expect(selected?.id).toBe('track-4')
      } finally {
        global.Date.now = originalNow
      }
    })

    it('should calculate time-based bonus correctly', () => {
      // Mock current time to 20 hours after last played
      const twentyHoursLater = new Date('2024-01-02T08:00:00Z').getTime()
      const originalNow = Date.now
      global.Date.now = () => twentyHoursLater

      try {
        const doneTracks = [
          {
            ...mockTracks[2], // track-3: rating 1.5, played 20 hours ago
            last_played_at: '2024-01-01T12:00:00Z'
          },
          {
            ...mockTracks[3], // track-4: rating 1.8, never played
            rating_score: 1.0 // Lower base rating
          }
        ]

        const selected = selectBestReplayTrack(doneTracks)
        
        // track-3: 1.5 + 2.0 (20h max bonus) = 3.5
        // track-4: 1.0 + 1.0 (never played bonus) = 2.0
        // Should select track-3
        expect(selected?.id).toBe('track-3')
      } finally {
        global.Date.now = originalNow
      }
    })

    it('should use rating_count as tiebreaker', () => {
      const doneTracks = [
        {
          ...mockTracks[0],
          id: 'track-tie-1',
          status: 'DONE' as const,
          rating_score: 1.5,
          rating_count: 20,
          last_played_at: null
        },
        {
          ...mockTracks[0],
          id: 'track-tie-2', 
          status: 'DONE' as const,
          rating_score: 1.5,
          rating_count: 5,
          last_played_at: null
        }
      ]

      const selected = selectBestReplayTrack(doneTracks)
      
      // Both have same score (1.5 + 1.0 never played bonus = 2.5)
      // Should prefer higher rating_count as tiebreaker
      expect(selected?.id).toBe('track-tie-1')
    })
  })

  describe('createReplayTrack', () => {
    it('should create replay track with correct properties', () => {
      const originalTrack = mockTracks[2] // DONE track
      const replayTrack = createReplayTrack(originalTrack)

      expect(replayTrack.user_id).toBe(originalTrack.user_id)
      expect(replayTrack.prompt).toBe(originalTrack.prompt)
      expect(replayTrack.duration_seconds).toBe(originalTrack.duration_seconds)
      expect(replayTrack.audio_url).toBe(originalTrack.audio_url)
      expect(replayTrack.eleven_request_id).toBe(originalTrack.eleven_request_id)
    })

    it('should set replay-specific properties', () => {
      const originalTrack = mockTracks[2]
      const replayTrack = createReplayTrack(originalTrack)

      expect(replayTrack.source).toBe('REPLAY')
      expect(replayTrack.status).toBe('READY')
      expect(replayTrack.price_usd).toBe(0) // Replays are free
      expect(replayTrack.x402_payment_tx).toBeNull()
    })

    it('should reset rating and timing properties', () => {
      const originalTrack = mockTracks[2] // Has ratings and last_played_at
      const replayTrack = createReplayTrack(originalTrack)

      expect(replayTrack.rating_score).toBe(0)
      expect(replayTrack.rating_count).toBe(0)
      expect(replayTrack.last_played_at).toBeNull()
      expect(replayTrack.started_at).toBeNull()
      expect(replayTrack.finished_at).toBeNull()
    })
  })
})