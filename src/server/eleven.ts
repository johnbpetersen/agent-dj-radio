// ElevenLabs Music API integration

import type { ElevenTrackRequest, ElevenTrackResponse, ElevenPollResponse } from '../types'

const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY
const ELEVEN_MUSIC_MODEL_ID = process.env.ELEVEN_MUSIC_MODEL_ID || 'eleven_music_v1'
const ELEVEN_BASE_URL = 'https://api.elevenlabs.io/v1'

// Duration limits enforced server-side (in seconds)
const VALID_DURATIONS = [60, 90, 120] as const
export type ValidDuration = typeof VALID_DURATIONS[number]

// Timeout for generation (3 minutes)
const GENERATION_TIMEOUT_MS = 3 * 60 * 1000
const POLL_INTERVAL_MS = 5000 // Poll every 5 seconds

export function validateDuration(duration: number): duration is ValidDuration {
  return VALID_DURATIONS.includes(duration as ValidDuration)
}

export interface CreateTrackParams {
  prompt: string
  durationSeconds: number
}

export interface CreateTrackResult {
  requestId: string
}

/**
 * Create a track generation request with ElevenLabs
 */
export async function createTrack({ prompt, durationSeconds }: CreateTrackParams): Promise<CreateTrackResult> {
  if (!ELEVEN_API_KEY) {
    throw new Error('ElevenLabs API key not configured')
  }

  if (!validateDuration(durationSeconds)) {
    throw new Error(`Invalid duration. Must be one of: ${VALID_DURATIONS.join(', ')}`)
  }

  if (!prompt || prompt.trim().length === 0) {
    throw new Error('Prompt cannot be empty')
  }

  if (prompt.length > 500) {
    throw new Error('Prompt too long (max 500 characters)')
  }

  const response = await fetch(`${ELEVEN_BASE_URL}/music/generation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVEN_API_KEY,
    },
    body: JSON.stringify({
      text: prompt.trim(),
      model_id: ELEVEN_MUSIC_MODEL_ID,
      duration: durationSeconds,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`ElevenLabs API error: ${response.status} ${error}`)
  }

  const data = await response.json()
  
  if (!data.request_id) {
    throw new Error('Invalid response from ElevenLabs API: missing request_id')
  }

  return {
    requestId: data.request_id
  }
}

export interface PollTrackParams {
  requestId: string
}

export interface PollTrackResult {
  status: 'queued' | 'processing' | 'ready' | 'failed'
  audioUrl?: string
  error?: string
}

/**
 * Poll track generation status
 */
export async function pollTrack({ requestId }: PollTrackParams): Promise<PollTrackResult> {
  if (!ELEVEN_API_KEY) {
    throw new Error('ElevenLabs API key not configured')
  }

  const response = await fetch(`${ELEVEN_BASE_URL}/music/generation/${requestId}`, {
    headers: {
      'xi-api-key': ELEVEN_API_KEY,
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      return {
        status: 'failed',
        error: 'Generation request not found'
      }
    }
    
    const error = await response.text()
    throw new Error(`ElevenLabs API error: ${response.status} ${error}`)
  }

  const data = await response.json()
  
  // Map ElevenLabs status to our status
  switch (data.state) {
    case 'pending':
      return { status: 'queued' }
    case 'processing':
      return { status: 'processing' }
    case 'complete':
      return { 
        status: 'ready', 
        audioUrl: data.audio_url 
      }
    case 'failed':
      return { 
        status: 'failed', 
        error: data.error || 'Generation failed' 
      }
    default:
      return { 
        status: 'failed', 
        error: `Unknown status: ${data.state}` 
      }
  }
}

/**
 * Poll track generation with timeout
 */
export async function pollTrackWithTimeout({ requestId }: PollTrackParams): Promise<PollTrackResult> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < GENERATION_TIMEOUT_MS) {
    try {
      const result = await pollTrack({ requestId })
      
      if (result.status === 'ready' || result.status === 'failed') {
        return result
      }
      
      // Continue polling for queued/processing
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    } catch (error) {
      console.error('Error polling ElevenLabs:', error)
      // Continue polling on errors
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }
  
  return {
    status: 'failed',
    error: 'Generation timeout exceeded'
  }
}

/**
 * Fetch audio file as buffer for storage
 */
export async function fetchToBuffer(audioUrl: string): Promise<Buffer> {
  if (!audioUrl) {
    throw new Error('Audio URL is required')
  }

  const response = await fetch(audioUrl)
  
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type')
  if (!contentType?.includes('audio')) {
    console.warn(`Unexpected content type: ${contentType}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}