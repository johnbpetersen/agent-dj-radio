import { describe, it, expect, beforeEach } from 'vitest'
import { testUtils } from '../../src/test/mocks/handlers'

describe('Reactions Aggregation', () => {
  beforeEach(() => {
    testUtils.resetMockData()
  })

  it('should calculate rating correctly for single reaction', async () => {
    const track = testUtils.addMockTrack({ rating_score: 0, rating_count: 0 })

    const response = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-1',
        kind: 'LOVE'
      })
    })

    const result = await response.json()
    expect(result.track.rating_score).toBe(2) // LOVE = 2 points
    expect(result.track.rating_count).toBe(1)
  })

  it('should calculate weighted average for multiple reactions', async () => {
    const track = testUtils.addMockTrack({ rating_score: 0, rating_count: 0 })

    // Add LOVE reaction (2 points)
    await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-1', 
        kind: 'LOVE'
      })
    })

    // Add FIRE reaction (1 point)
    const response = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-2',
        kind: 'FIRE'
      })
    })

    const result = await response.json()
    // (2 + 1) / 2 = 1.5
    expect(result.track.rating_score).toBe(1.5)
    expect(result.track.rating_count).toBe(2)
  })

  it('should handle negative reactions correctly', async () => {
    const track = testUtils.addMockTrack({ rating_score: 0, rating_count: 0 })

    // LOVE (2) + SKIP (-1) = 1 / 2 = 0.5
    await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-1',
        kind: 'LOVE'
      })
    })

    const response = await fetch('/api/reactions', {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-2',
        kind: 'SKIP'
      })
    })

    const result = await response.json()
    expect(result.track.rating_score).toBe(0.5)
    expect(result.track.rating_count).toBe(2)
  })

  it('should handle all negative reactions', async () => {
    const track = testUtils.addMockTrack({ rating_score: 0, rating_count: 0 })

    // Two SKIP reactions: (-1 + -1) / 2 = -1
    await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-1',
        kind: 'SKIP'
      })
    })

    const response = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-2', 
        kind: 'SKIP'
      })
    })

    const result = await response.json()
    expect(result.track.rating_score).toBe(-1)
    expect(result.track.rating_count).toBe(2)
  })

  it('should validate reaction input', async () => {
    const track = testUtils.addMockTrack({})

    // Missing fields
    let response = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-1'
        // missing kind
      })
    })

    expect(response.status).toBe(400)

    // Invalid reaction kind
    response = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-1',
        kind: 'INVALID'
      })
    })

    expect(response.status).toBe(400)

    // Non-existent track
    response = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: 'non-existent',
        user_id: 'user-1',
        kind: 'LOVE'
      })
    })

    expect(response.status).toBe(404)
  })

  it('should return correct response format', async () => {
    const track = testUtils.addMockTrack({})

    const response = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-1',
        kind: 'LOVE'
      })
    })

    const result = await response.json()

    expect(result).toHaveProperty('reaction')
    expect(result).toHaveProperty('track')
    
    expect(result.reaction).toHaveProperty('id')
    expect(result.reaction).toHaveProperty('track_id', track.id)
    expect(result.reaction).toHaveProperty('user_id', 'user-1')
    expect(result.reaction).toHaveProperty('kind', 'LOVE')
    expect(result.reaction).toHaveProperty('created_at')

    expect(result.track).toHaveProperty('id', track.id)
    expect(result.track).toHaveProperty('rating_score')
    expect(result.track).toHaveProperty('rating_count')
  })
})