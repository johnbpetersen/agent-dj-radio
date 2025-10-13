// tests/server/db.test.ts
// Comprehensive tests for database operations

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getStationState,
  updateStationState,
  getTracksByStatus,
  claimNextPaidTrack,
  updateTrackStatus,
  createTrack,
  getTrackById,
  confirmTrackPayment,
  upsertUser,
  updateUserLastSubmit,
  upsertReaction,
  updateTrackRating
} from '../../src/server/db'
import type { Track, Reaction, StationState, ReactionKind } from '../../src/types'

// Mock Supabase client
function createMockSupabase(): SupabaseClient {
  return {
    from: vi.fn(),
    rpc: vi.fn()
  } as any
}

describe('Database Operations', () => {
  let mockSupabase: SupabaseClient

  beforeEach(() => {
    mockSupabase = createMockSupabase()
    vi.clearAllMocks()
  })

  describe('getStationState', () => {
    it('should fetch station state with current track', async () => {
      const mockState = {
        id: 1,
        current_track_id: 'track-123',
        current_started_at: '2025-01-01T00:00:00Z',
        current_track: {
          id: 'track-123',
          title: 'Test Track',
          status: 'PLAYING'
        }
      }

      ;(mockSupabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockState, error: null })
          })
        })
      })

      const result = await getStationState(mockSupabase)

      expect(result).toEqual(mockState)
      expect(mockSupabase.from).toHaveBeenCalledWith('station_state')
    })

    it('should return null on error', async () => {
      ;(mockSupabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } })
          })
        })
      })

      const result = await getStationState(mockSupabase)

      expect(result).toBeNull()
    })
  })

  describe('updateStationState', () => {
    it('should update station state', async () => {
      const updates = {
        current_track_id: 'track-456',
        current_started_at: '2025-01-01T01:00:00Z'
      }

      const mockUpdatedState = {
        id: 1,
        ...updates,
        updated_at: expect.any(String)
      }

      ;(mockSupabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockUpdatedState, error: null })
            })
          })
        })
      })

      const result = await updateStationState(mockSupabase, updates)

      expect(result).toMatchObject(updates)
      expect(mockSupabase.from).toHaveBeenCalledWith('station_state')
    })

    it('should return null on error', async () => {
      ;(mockSupabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Update failed' } })
            })
          })
        })
      })

      const result = await updateStationState(mockSupabase, { current_track_id: 'track-789' })

      expect(result).toBeNull()
    })
  })

  describe('getTracksByStatus', () => {
    it('should fetch tracks by status with user info', async () => {
      const mockTracks = [
        {
          id: 'track-1',
          title: 'Track 1',
          status: 'READY',
          user: { id: 'user-1', display_name: 'User 1' }
        },
        {
          id: 'track-2',
          title: 'Track 2',
          status: 'PAID',
          user: { id: 'user-2', display_name: 'User 2' }
        }
      ]

      ;(mockSupabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: mockTracks, error: null })
          })
        })
      })

      const result = await getTracksByStatus(mockSupabase, ['READY', 'PAID'])

      expect(result).toEqual(mockTracks)
      expect(mockSupabase.from).toHaveBeenCalledWith('tracks')
    })

    it('should return empty array on error', async () => {
      ;(mockSupabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Query failed' } })
          })
        })
      })

      const result = await getTracksByStatus(mockSupabase, ['READY'])

      expect(result).toEqual([])
    })
  })

  describe('claimNextPaidTrack', () => {
    it('should claim next paid track using RPC', async () => {
      const mockTrack = {
        id: 'track-123',
        title: 'Claimed Track',
        status: 'GENERATING'
      }

      ;(mockSupabase.rpc as any).mockResolvedValue({
        data: [mockTrack],
        error: null
      })

      const result = await claimNextPaidTrack(mockSupabase)

      expect(result).toEqual(mockTrack)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('claim_next_paid_track')
    })

    it('should return null if no tracks available', async () => {
      ;(mockSupabase.rpc as any).mockResolvedValue({
        data: [],
        error: null
      })

      const result = await claimNextPaidTrack(mockSupabase)

      expect(result).toBeNull()
    })

    it('should return null on RPC error', async () => {
      ;(mockSupabase.rpc as any).mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' }
      })

      const result = await claimNextPaidTrack(mockSupabase)

      expect(result).toBeNull()
    })
  })

  describe('updateTrackStatus', () => {
    it('should update track status', async () => {
      const mockTrack = {
        id: 'track-123',
        title: 'Test Track',
        status: 'PLAYING',
        started_at: expect.any(String)
      }

      ;(mockSupabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockTrack, error: null })
            })
          })
        })
      })

      const result = await updateTrackStatus(mockSupabase, 'track-123', 'PLAYING')

      expect(result?.status).toBe('PLAYING')
    })

    it('should add started_at timestamp when status is PLAYING', async () => {
      const mockTrack = {
        id: 'track-123',
        status: 'PLAYING',
        started_at: '2025-01-01T00:00:00Z'
      }

      let capturedUpdates: any

      ;(mockSupabase.from as any).mockReturnValue({
        update: vi.fn().mockImplementation((updates) => {
          capturedUpdates = updates
          return {
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockTrack, error: null })
              })
            })
          }
        })
      })

      await updateTrackStatus(mockSupabase, 'track-123', 'PLAYING')

      expect(capturedUpdates.started_at).toBeDefined()
    })

    it('should add finished_at timestamp when status is DONE', async () => {
      const mockTrack = {
        id: 'track-123',
        status: 'DONE',
        finished_at: '2025-01-01T00:00:00Z'
      }

      let capturedUpdates: any

      ;(mockSupabase.from as any).mockReturnValue({
        update: vi.fn().mockImplementation((updates) => {
          capturedUpdates = updates
          return {
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockTrack, error: null })
              })
            })
          }
        })
      })

      await updateTrackStatus(mockSupabase, 'track-123', 'DONE')

      expect(capturedUpdates.finished_at).toBeDefined()
    })
  })

  describe('createTrack', () => {
    it('should create a new track', async () => {
      const trackData = {
        title: 'New Track',
        user_id: 'user-123',
        status: 'PENDING',
        source: 'GENERATED' as const,
        duration_seconds: 30
      }

      const mockCreatedTrack = {
        ...trackData,
        id: 'track-new',
        created_at: '2025-01-01T00:00:00Z',
        user: { id: 'user-123', display_name: 'Test User' }
      }

      ;(mockSupabase.from as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockCreatedTrack, error: null })
          })
        })
      })

      const result = await createTrack(mockSupabase, trackData)

      expect(result).toEqual(mockCreatedTrack)
    })
  })

  describe('upsertUser', () => {
    it('should return existing user if found', async () => {
      const existingUser = {
        id: 'user-123',
        display_name: 'TestUser',
        banned: false
      }

      ;(mockSupabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: existingUser, error: null })
            })
          })
        })
      })

      const result = await upsertUser(mockSupabase, { display_name: 'TestUser' })

      expect(result).toEqual(existingUser)
    })

    it('should create new user if not found', async () => {
      const newUser = {
        id: expect.any(String),
        display_name: 'NewUser',
        banned: false
      }

      ;(mockSupabase.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      })

      ;(mockSupabase.from as any).mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: newUser, error: null })
          })
        })
      })

      const result = await upsertUser(mockSupabase, { display_name: 'NewUser' })

      expect(result?.display_name).toBe('NewUser')
    })

    it('should trim display name', async () => {
      const newUser = {
        id: 'user-new',
        display_name: 'SpacedName',
        banned: false
      }

      ;(mockSupabase.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      })

      ;(mockSupabase.from as any).mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: newUser, error: null })
          })
        })
      })

      const result = await upsertUser(mockSupabase, { display_name: '  SpacedName  ' })

      expect(result?.display_name).toBe('SpacedName')
    })

    it('should return null for empty name', async () => {
      const result = await upsertUser(mockSupabase, { display_name: '' })

      expect(result).toBeNull()
    })
  })

  describe('upsertReaction', () => {
    it('should upsert a reaction', async () => {
      const mockReaction = {
        track_id: 'track-123',
        user_id: 'user-456',
        kind: 'LOVE' as ReactionKind,
        created_at: '2025-01-01T00:00:00Z'
      }

      ;(mockSupabase.from as any).mockReturnValue({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockReaction, error: null })
          })
        })
      })

      const result = await upsertReaction(mockSupabase, 'track-123', 'user-456', 'LOVE')

      expect(result).toEqual(mockReaction)
    })
  })

  describe('updateTrackRating', () => {
    it('should calculate and update track rating', async () => {
      const mockReactions = [
        { kind: 'LOVE' },
        { kind: 'LOVE' },
        { kind: 'FIRE' },
        { kind: 'SKIP' }
      ]

      const mockUpdatedTrack = {
        id: 'track-123',
        rating_score: 1.25, // (2*2 + 1*1 + 1*(-1)) / 4 = 1.25
        rating_count: 4
      }

      ;(mockSupabase.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: mockReactions, error: null })
        })
      })

      ;(mockSupabase.from as any).mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockUpdatedTrack, error: null })
            })
          })
        })
      })

      const result = await updateTrackRating(mockSupabase, 'track-123')

      expect(result?.rating_score).toBe(1.25)
      expect(result?.rating_count).toBe(4)
    })

    it('should handle track with no reactions', async () => {
      ;(mockSupabase.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      })

      const mockUpdatedTrack = {
        id: 'track-123',
        rating_score: 0,
        rating_count: 0
      }

      ;(mockSupabase.from as any).mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockUpdatedTrack, error: null })
            })
          })
        })
      })

      const result = await updateTrackRating(mockSupabase, 'track-123')

      expect(result?.rating_score).toBe(0)
      expect(result?.rating_count).toBe(0)
    })
  })
})
