import { describe, it, expect, beforeEach } from 'vitest'
import { testUtils } from '../../src/test/mocks/handlers'

describe('Submit → Generate → Advance Flow', () => {
  beforeEach(() => {
    testUtils.resetMockData()
  })

  it('should complete full track lifecycle', async () => {
    // Step 1: Get price quote
    const quoteResponse = await fetch('/api/queue/price-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_seconds: 120 })
    })
    
    expect(quoteResponse.status).toBe(200)
    const quote = await quoteResponse.json()
    expect(quote.price_usd).toBe(5.40)

    // Step 2: Submit track
    const submitResponse = await fetch('/api/queue/submit', {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Epic orchestral battle theme',
        duration_seconds: 120,
        user_id: 'user-composer'
      })
    })

    expect(submitResponse.status).toBe(201)
    const submitResult = await submitResponse.json()
    expect(submitResult.track.status).toBe('PAID')
    expect(submitResult.track.audio_url).toBeNull()

    // Step 3: Check initial station state (should be empty)
    let stateResponse = await fetch('/api/station/state')
    let state = await stateResponse.json()
    expect(state.station_state.current_track).toBeNull()
    expect(state.queue).toHaveLength(1)
    expect(state.queue[0].status).toBe('PAID')

    // Step 4: Generate track (mock)
    const generateResponse = await fetch('/api/worker/generate', {
      method: 'POST'
    })

    expect(generateResponse.status).toBe(200)
    const generateResult = await generateResponse.json()
    expect(generateResult.processed).toBe(true)
    expect(generateResult.track.status).toBe('READY')
    expect(generateResult.track.audio_url).toBe('/sample-track.mp3')

    // Step 5: Check state after generation
    stateResponse = await fetch('/api/station/state')
    state = await stateResponse.json()
    expect(state.queue).toHaveLength(1)
    expect(state.queue[0].status).toBe('READY')
    expect(state.queue[0].audio_url).toBe('/sample-track.mp3')

    // Step 6: Advance station to start playing
    const advanceResponse = await fetch('/api/station/advance', {
      method: 'POST'
    })

    expect(advanceResponse.status).toBe(200)
    const advanceResult = await advanceResponse.json()
    expect(advanceResult.advanced).toBe(true)
    expect(advanceResult.current_track.status).toBe('PLAYING')
    expect(advanceResult.playhead_seconds).toBe(0)

    // Step 7: Final state check
    stateResponse = await fetch('/api/station/state')
    state = await stateResponse.json()
    expect(state.station_state.current_track).not.toBeNull()
    expect(state.station_state.current_track.status).toBe('PLAYING')
    expect(state.queue).toHaveLength(0) // Track moved from queue to playing
  })

  it('should handle multiple tracks in sequence', async () => {
    // Submit first track
    await fetch('/api/queue/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'First track',
        duration_seconds: 60,
        user_id: 'user-1'
      })
    })

    // Submit second track
    await fetch('/api/queue/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Second track',
        duration_seconds: 90,
        user_id: 'user-2'
      })
    })

    // Generate both tracks
    await fetch('/api/worker/generate', { method: 'POST' })
    await fetch('/api/worker/generate', { method: 'POST' })

    // Check queue has both ready tracks
    let stateResponse = await fetch('/api/station/state')
    let state = await stateResponse.json()
    expect(state.queue).toHaveLength(2)
    expect(state.queue.every((t: any) => t.status === 'READY')).toBe(true)

    // Advance to first track
    await fetch('/api/station/advance', { method: 'POST' })
    
    stateResponse = await fetch('/api/station/state')
    state = await stateResponse.json()
    expect(state.station_state.current_track.prompt).toBe('First track')
    expect(state.queue).toHaveLength(1) // Second track still queued

    // Mock time passage to finish first track
    const originalNow = Date.now
    const startTime = Date.now()
    global.Date.now = () => startTime + 61000 // 61 seconds (past first track duration)

    try {
      // Advance to second track
      await fetch('/api/station/advance', { method: 'POST' })
      
      stateResponse = await fetch('/api/station/state')
      state = await stateResponse.json()
      
      // Check that we have a current track (might be second track or a replay)
      expect(state.station_state.current_track).not.toBeNull()
      expect(state.queue).toHaveLength(0) // Queue now empty
    } finally {
      global.Date.now = originalNow
    }
  })

  it('should handle generation when no PAID tracks exist', async () => {
    const generateResponse = await fetch('/api/worker/generate', {
      method: 'POST'
    })

    expect(generateResponse.status).toBe(200)
    const result = await generateResponse.json()
    expect(result.processed).toBe(false)
    expect(result.message).toContain('No tracks to generate')
  })

  it('should create replays when no READY tracks available', async () => {
    // Create a highly rated DONE track
    const doneTrack = testUtils.addMockTrack({
      status: 'DONE',
      rating_score: 1.8,
      rating_count: 10,
      last_played_at: '2024-01-01T10:00:00Z'
    })

    // Try to advance (should create replay)
    const advanceResponse = await fetch('/api/station/advance', {
      method: 'POST'
    })

    expect(advanceResponse.status).toBe(200)
    const result = await advanceResponse.json()
    expect(result.advanced).toBe(true)
    expect(result.current_track).not.toBeNull()
    expect(result.current_track.prompt).toBe(doneTrack.prompt) // Same prompt as original
    expect(result.replay_created).not.toBeNull()

    // Verify replay properties
    expect(result.replay_created.source).toBe('REPLAY')
    expect(result.replay_created.price_usd).toBe(0)
    expect(result.replay_created.rating_score).toBe(0) // Reset rating
  })

  it('should add reactions and update ratings during playback', async () => {
    // Submit and generate a track
    const submitResponse = await fetch('/api/queue/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Track to rate',
        duration_seconds: 120,
        user_id: 'user-1'
      })
    })

    const track = (await submitResponse.json()).track
    await fetch('/api/worker/generate', { method: 'POST' })
    await fetch('/api/station/advance', { method: 'POST' })

    // Add some reactions
    await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-1',
        kind: 'LOVE'
      })
    })

    await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        user_id: 'user-2',
        kind: 'FIRE'
      })
    })

    // Check final state shows updated ratings
    const stateResponse = await fetch('/api/station/state')
    const state = await stateResponse.json()
    
    expect(state.station_state.current_track.rating_count).toBe(2)
    expect(state.station_state.current_track.rating_score).toBe(1.5) // (2 + 1) / 2
  })
})