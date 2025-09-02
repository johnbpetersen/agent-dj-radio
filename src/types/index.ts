// Database types matching the Supabase schema

export type TrackSource = 'GENERATED' | 'REPLAY'
export type TrackStatus = 'PENDING_PAYMENT' | 'PAID' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'
export type ReactionKind = 'LOVE' | 'FIRE' | 'SKIP'

export interface User {
  id: string
  display_name: string
  banned: boolean
  created_at: string
  last_submit_at?: string | null // For rate limiting
}

export interface Track {
  id: string
  user_id: string
  prompt: string
  duration_seconds: number
  source: TrackSource
  status: TrackStatus
  price_usd: number
  x402_payment_tx: any | null
  eleven_request_id: string | null
  audio_url: string | null
  rating_score: number
  rating_count: number
  last_played_at: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  // Joined user data
  user?: User
}

export interface Reaction {
  id: string
  track_id: string
  user_id: string
  kind: ReactionKind
  created_at: string
}

export interface StationState {
  id: number
  current_track_id: string | null
  current_started_at: string | null
  updated_at: string
  // Joined current track data
  current_track?: Track | null
}

// API request/response types
export interface PriceQuoteRequest {
  duration_seconds: number
}

export interface PriceQuoteResponse {
  price_usd: number
  duration_seconds: number
}

export interface SubmitTrackRequest {
  prompt: string
  duration_seconds: number
  user_id: string
}

export interface SubmitTrackResponse {
  track: Track
}

// x402 Payment types
export interface X402Challenge {
  amount: string
  asset: string
  chain: string
  payTo: string
  nonce: string
  expiresAt: string
}

export interface X402ChallengeResponse {
  challenge: X402Challenge
  track_id: string
}

export interface X402ConfirmRequest {
  track_id: string
  payment_proof: string
}

export interface X402ConfirmResponse {
  track: Track
  payment_verified: boolean
}

// ElevenLabs types
export interface ElevenTrackRequest {
  prompt: string
  duration_seconds: number
}

export interface ElevenTrackResponse {
  request_id: string
}

export interface ElevenPollResponse {
  status: 'queued' | 'processing' | 'ready' | 'failed'
  audio_url?: string
  error?: string
}

export interface StationStateResponse {
  station_state: StationState
  queue: Track[]
  playhead_seconds?: number
}

export interface ReactionRequest {
  track_id: string
  user_id: string
  kind: ReactionKind
}

export interface ReactionResponse {
  reaction: Reaction
  track: Track // Updated track with new rating
}

// Client-side state types
export interface StationData {
  currentTrack: Track | null
  playheadSeconds: number
  queue: Track[]
  isLoading: boolean
  error: string | null
}

// Rate limiting
export interface RateLimitInfo {
  user_id: string
  last_submit_at: number
  cooldown_seconds: number
}