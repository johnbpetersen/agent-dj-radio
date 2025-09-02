import { http, HttpResponse } from 'msw'
import type { 
  PriceQuoteRequest, 
  PriceQuoteResponse, 
  SubmitTrackRequest, 
  SubmitTrackResponse,
  X402ChallengeResponse,
  X402ConfirmRequest,
  X402ConfirmResponse,
  StationStateResponse,
  ReactionRequest,
  ReactionResponse,
  Track,
  StationState
} from '../../types'

// Mock data
let mockTracks: Track[] = []
let mockStationState: StationState = {
  id: 1,
  current_track_id: null,
  current_started_at: null,
  updated_at: new Date().toISOString()
}
let trackIdCounter = 1

// Test configuration - can be set by tests
let mockX402Enabled = false

// Helper to create mock track
function createMockTrack(data: Partial<Track>): Track {
  return {
    id: `track-${trackIdCounter++}`,
    user_id: 'mock-user-1',
    prompt: 'Test track',
    duration_seconds: 120,
    source: 'GENERATED',
    status: 'PAID',
    price_usd: 5.40,
    x402_payment_tx: null,
    eleven_request_id: null,
    audio_url: null,
    rating_score: 0,
    rating_count: 0,
    last_played_at: null,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    user: {
      id: 'mock-user-1',
      display_name: 'Test User',
      banned: false,
      created_at: new Date().toISOString()
    },
    ...data
  }
}

export const handlers = [
  // Method not allowed handlers
  http.get('/api/queue/price-quote', () => HttpResponse.json({ error: 'Method not allowed' }, { status: 405 })),
  http.get('/api/queue/submit', () => HttpResponse.json({ error: 'Method not allowed' }, { status: 405 })),
  http.post('/api/station/state', () => HttpResponse.json({ error: 'Method not allowed' }, { status: 405 })),
  http.get('/api/station/advance', () => HttpResponse.json({ error: 'Method not allowed' }, { status: 405 })),
  // Price quote endpoint
  http.post('/api/queue/price-quote', async ({ request }) => {
    const body = await request.json() as PriceQuoteRequest
    
    if (!body.duration_seconds || ![60, 90, 120].includes(body.duration_seconds)) {
      return HttpResponse.json(
        { error: 'Invalid duration. Must be 60, 90, or 120 seconds.' },
        { status: 400 }
      )
    }

    const prices = { 60: 3.00, 90: 4.27, 120: 5.40 }
    const response: PriceQuoteResponse = {
      price_usd: prices[body.duration_seconds as keyof typeof prices],
      duration_seconds: body.duration_seconds
    }

    return HttpResponse.json(response)
  }),

  // Submit track endpoint
  http.post('/api/queue/submit', async ({ request }) => {
    const body = await request.json() as SubmitTrackRequest
    
    if (!body.prompt?.trim() || !body.user_id || !body.duration_seconds) {
      return HttpResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (![60, 90, 120].includes(body.duration_seconds)) {
      return HttpResponse.json(
        { error: 'Invalid duration. Must be 60, 90, or 120 seconds.' },
        { status: 400 }
      )
    }

    // Calculate price based on duration
    const priceMap = { 60: 3.00, 90: 4.27, 120: 5.40 }
    const price_usd = priceMap[body.duration_seconds]

    if (!mockX402Enabled) {
      // Sprint 1 behavior: create PAID track immediately
      const track = createMockTrack({
        prompt: body.prompt.trim(),
        duration_seconds: body.duration_seconds,
        user_id: body.user_id,
        status: 'PAID',
        price_usd
      })

      mockTracks.push(track)
      
      const response: SubmitTrackResponse = { track }
      return HttpResponse.json(response, { status: 201 })
    } else {
      // x402 flow: create PENDING_PAYMENT track and return challenge
      const track = createMockTrack({
        prompt: body.prompt.trim(),
        duration_seconds: body.duration_seconds,
        user_id: body.user_id,
        status: 'PENDING_PAYMENT',
        price_usd
      })

      mockTracks.push(track)
      
      const challenge = {
        amount: price_usd.toFixed(2),
        asset: 'USD',
        chain: 'test',
        payTo: 'test-address',
        nonce: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      }

      const response: X402ChallengeResponse = {
        challenge,
        track_id: track.id
      }
      return HttpResponse.json(response, { status: 402 })
    }
  }),

  // Confirm payment endpoint  
  http.post('/api/queue/confirm', async ({ request }) => {
    const body = await request.json() as X402ConfirmRequest
    
    if (!body.track_id) {
      return HttpResponse.json(
        { error: 'Track ID is required' },
        { status: 400 }
      )
    }

    if (!body.payment_proof) {
      return HttpResponse.json(
        { error: 'Payment proof is required' },
        { status: 400 }
      )
    }

    const track = mockTracks.find(t => t.id === body.track_id)
    
    if (!track) {
      return HttpResponse.json(
        { error: 'Track not found' },
        { status: 404 }
      )
    }

    // Idempotency: if already PAID, return success
    if (track.status === 'PAID') {
      const response: X402ConfirmResponse = {
        track,
        payment_verified: true
      }
      return HttpResponse.json(response, { status: 200 })
    }

    // Only allow confirmation for PENDING_PAYMENT tracks
    if (track.status !== 'PENDING_PAYMENT') {
      return HttpResponse.json({
        error: `Cannot confirm payment for track with status: ${track.status}`
      }, { status: 400 })
    }

    // Update track to PAID status
    track.status = 'PAID'
    track.x402_payment_tx = body.payment_proof

    const response: X402ConfirmResponse = {
      track,
      payment_verified: true
    }
    return HttpResponse.json(response, { status: 200 })
  }),

  http.get('/api/queue/confirm', () => HttpResponse.json({ error: 'Method not allowed' }, { status: 405 })),

  // Generate worker endpoint
  http.post('/api/worker/generate', async () => {
    const paidTrack = mockTracks.find(t => t.status === 'PAID')
    
    if (!paidTrack) {
      return HttpResponse.json({
        message: 'No tracks to generate',
        processed: false
      })
    }

    // Update track to READY with mock audio
    paidTrack.status = 'READY'
    paidTrack.audio_url = '/sample-track.mp3'
    paidTrack.eleven_request_id = `mock_${paidTrack.id}_${Date.now()}`

    return HttpResponse.json({
      message: 'Track generated successfully',
      processed: true,
      track: paidTrack
    })
  }),

  // Station advance endpoint
  http.post('/api/station/advance', async () => {
    // Check if current track is still playing
    if (mockStationState.current_track_id && mockStationState.current_started_at) {
      const currentTrack = mockTracks.find(t => t.id === mockStationState.current_track_id)
      if (currentTrack) {
        const elapsedMs = Date.now() - new Date(mockStationState.current_started_at).getTime()
        const elapsedSeconds = Math.floor(elapsedMs / 1000)
        
        // If track is still playing, don't advance
        if (elapsedSeconds < currentTrack.duration_seconds) {
          return HttpResponse.json({
            message: 'Current track still playing',
            advanced: false,
            current_track: currentTrack,
            playhead_seconds: elapsedSeconds
          })
        }
        
        // Mark current track as DONE
        currentTrack.status = 'DONE'
        currentTrack.last_played_at = new Date().toISOString()
      }
    }

    // Find next READY track
    const readyTrack = mockTracks.find(t => t.status === 'READY')
    
    if (readyTrack) {
      readyTrack.status = 'PLAYING'
      readyTrack.started_at = new Date().toISOString()
      
      mockStationState.current_track_id = readyTrack.id
      mockStationState.current_started_at = new Date().toISOString()
      
      return HttpResponse.json({
        message: 'Station advanced successfully',
        advanced: true,
        current_track: readyTrack,
        playhead_seconds: 0
      })
    }

    // Try to create replay from best DONE track
    const doneTracks = mockTracks.filter(t => t.status === 'DONE')
    if (doneTracks.length > 0) {
      // Simple replay selection - pick highest rated
      const bestReplay = doneTracks.sort((a, b) => (b.rating_score || 0) - (a.rating_score || 0))[0]
      
      // Create replay track
      const replayTrack = createMockTrack({
        ...bestReplay,
        source: 'REPLAY',
        status: 'PLAYING',
        price_usd: 0,
        rating_score: 0,
        rating_count: 0,
        last_played_at: null,
        started_at: new Date().toISOString()
      })
      
      mockTracks.push(replayTrack)
      
      mockStationState.current_track_id = replayTrack.id
      mockStationState.current_started_at = new Date().toISOString()
      
      return HttpResponse.json({
        message: 'Station advanced successfully',
        advanced: true,
        current_track: replayTrack,
        playhead_seconds: 0,
        replay_created: replayTrack
      })
    }

    // No tracks available
    mockStationState.current_track_id = null
    mockStationState.current_started_at = null
    
    return HttpResponse.json({
      message: 'No tracks available to play',
      advanced: true,
      current_track: null,
      playhead_seconds: 0
    })
  }),

  // Station state endpoint
  http.get('/api/station/state', () => {
    const currentTrack = mockStationState.current_track_id 
      ? mockTracks.find(t => t.id === mockStationState.current_track_id) || null
      : null

    const queue = mockTracks.filter(t => 
      ['READY', 'PAID', 'GENERATING'].includes(t.status)
    )

    // Calculate playhead
    let playheadSeconds = 0
    if (currentTrack && mockStationState.current_started_at) {
      const elapsed = Date.now() - new Date(mockStationState.current_started_at).getTime()
      playheadSeconds = Math.floor(elapsed / 1000)
    }

    const response: StationStateResponse = {
      station_state: {
        ...mockStationState,
        current_track: currentTrack
      },
      queue,
      playhead_seconds: playheadSeconds
    }

    return HttpResponse.json(response)
  }),

  // Reactions endpoint
  http.post('/api/reactions', async ({ request }) => {
    const body = await request.json() as ReactionRequest
    
    if (!body.track_id || !body.user_id || !body.kind) {
      return HttpResponse.json(
        { error: 'Missing required fields: track_id, user_id, kind' },
        { status: 400 }
      )
    }

    if (!['LOVE', 'FIRE', 'SKIP'].includes(body.kind)) {
      return HttpResponse.json(
        { error: 'Invalid reaction kind. Must be one of: LOVE, FIRE, SKIP' },
        { status: 400 }
      )
    }

    const track = mockTracks.find(t => t.id === body.track_id)
    if (!track) {
      return HttpResponse.json(
        { error: 'Track not found' },
        { status: 404 }
      )
    }

    // Mock reaction
    const reaction = {
      id: `reaction-${Date.now()}`,
      track_id: body.track_id,
      user_id: body.user_id,
      kind: body.kind,
      created_at: new Date().toISOString()
    }

    // Update track rating (simplified)
    track.rating_count = (track.rating_count || 0) + 1
    const scoreMap = { LOVE: 2, FIRE: 1, SKIP: -1 }
    const newScore = scoreMap[body.kind]
    track.rating_score = ((track.rating_score || 0) * (track.rating_count - 1) + newScore) / track.rating_count

    const response: ReactionResponse = {
      reaction,
      track
    }

    return HttpResponse.json(response)
  })
]

// Test utilities for resetting mock data
export const testUtils = {
  resetMockData: () => {
    mockTracks = []
    mockStationState = {
      id: 1,
      current_track_id: null,
      current_started_at: null,
      updated_at: new Date().toISOString()
    }
    trackIdCounter = 1
    mockX402Enabled = false // Reset to Sprint 1 mode by default
  },
  
  addMockTrack: (data: Partial<Track>) => {
    const track = createMockTrack(data)
    mockTracks.push(track)
    return track
  },
  
  setCurrentTrack: (trackId: string) => {
    mockStationState.current_track_id = trackId
    mockStationState.current_started_at = new Date().toISOString()
  },
  
  // X402 test configuration
  enableX402Mode: () => {
    mockX402Enabled = true
  },
  
  disableX402Mode: () => {
    mockX402Enabled = false
  },
  
  isX402Enabled: () => mockX402Enabled,
  
  getMockTracks: () => [...mockTracks],
  getMockStationState: () => ({ ...mockStationState })
}