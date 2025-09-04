// ElevenLabs Music API integration with enhanced rate limiting and retries

import type { ElevenTrackRequest, ElevenTrackResponse, ElevenPollResponse } from '../types'
import { logger, generateCorrelationId } from '../lib/logger.js'
import { errorTracker } from '../lib/error-tracking.js'

const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY
const ELEVEN_MUSIC_MODEL_ID = process.env.ELEVEN_MUSIC_MODEL_ID || 'eleven_music_v1'
const ELEVEN_BASE_URL = 'https://api.elevenlabs.io/v1'

// Duration limits enforced server-side (in seconds)
const VALID_DURATIONS = [60, 90, 120] as const
export type ValidDuration = typeof VALID_DURATIONS[number]

// Timeout for generation (3 minutes in staging, 5 minutes in production)
const isStaging = process.env.NODE_ENV === 'staging'
const GENERATION_TIMEOUT_MS = isStaging ? 3 * 60 * 1000 : 5 * 60 * 1000
const POLL_INTERVAL_MS = 5000 // Poll every 5 seconds

// Rate limiting configuration
const RATE_LIMIT_REQUESTS_PER_MINUTE = isStaging ? 5 : 20 // Conservative limit for staging
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute window
const MAX_RETRY_ATTEMPTS = isStaging ? 2 : 3 // Fewer retries in staging
const RETRY_BACKOFF_BASE_MS = 2000 // 2 seconds base backoff

// Rate limiting state (in-memory for simplicity)
let rateLimitRequests: number[] = []

/**
 * Check if we're within rate limits
 */
function checkRateLimit(): { allowed: boolean; resetTimeMs?: number } {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  
  // Remove expired requests
  rateLimitRequests = rateLimitRequests.filter(timestamp => timestamp > windowStart)
  
  if (rateLimitRequests.length >= RATE_LIMIT_REQUESTS_PER_MINUTE) {
    const oldestRequest = Math.min(...rateLimitRequests)
    const resetTimeMs = oldestRequest + RATE_LIMIT_WINDOW_MS - now
    
    return {
      allowed: false,
      resetTimeMs: Math.max(0, resetTimeMs)
    }
  }
  
  // Record this request
  rateLimitRequests.push(now)
  return { allowed: true }
}

/**
 * Sleep for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function validateDuration(duration: number): duration is ValidDuration {
  return VALID_DURATIONS.includes(duration as ValidDuration)
}

export interface CreateTrackParams {
  prompt: string
  durationSeconds: number
}

export interface CreateTrackResult {
  requestId: string
  audioBuffer?: Buffer // For synchronous responses
}

/**
 * Create a track generation request with ElevenLabs (with rate limiting and retries)
 */
export async function createTrack({ prompt, durationSeconds }: CreateTrackParams): Promise<CreateTrackResult> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()
  
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

  logger.info('Starting ElevenLabs track creation', {
    correlationId,
    prompt: prompt.slice(0, 100), // Log first 100 chars only
    durationSeconds,
    modelId: ELEVEN_MUSIC_MODEL_ID,
    isStaging
  })

  // Check rate limits before making request
  const rateLimitCheck = checkRateLimit()
  if (!rateLimitCheck.allowed) {
    const error = new Error(`ElevenLabs rate limit exceeded. Try again in ${Math.ceil((rateLimitCheck.resetTimeMs || 0) / 1000)} seconds`)
    
    errorTracker.trackError(error, {
      operation: 'eleven-create-track',
      correlationId,
      rateLimitResetMs: rateLimitCheck.resetTimeMs
    })
    
    throw error
  }

  let lastError: Error | null = null
  
  // Retry loop with exponential backoff
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      logger.info('ElevenLabs API request attempt', {
        correlationId,
        attempt,
        maxAttempts: MAX_RETRY_ATTEMPTS
      })

      const response = await fetch(`${ELEVEN_BASE_URL}/music`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVEN_API_KEY,
          'User-Agent': 'Agent-DJ-Radio/1.0'
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          music_length_ms: durationSeconds * 1000,
          instrumental: true
        }),
        signal: AbortSignal.timeout(30000) // 30 second timeout for creation request
      })

      if (!response.ok) {
        const errorText = await response.text()
        const error = new Error(`ElevenLabs API error: ${response.status} ${errorText}`)
        
        // Check if it's a retryable error
        if (response.status === 429 || response.status >= 500) {
          lastError = error
          
          logger.warn('Retryable ElevenLabs error', {
            correlationId,
            attempt,
            status: response.status,
            error: errorText
          })
          
          if (attempt < MAX_RETRY_ATTEMPTS) {
            const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt - 1)
            logger.info('Retrying ElevenLabs request', {
              correlationId,
              attempt,
              backoffMs
            })
            
            await sleep(backoffMs)
            continue
          }
        }
        
        // Non-retryable error
        errorTracker.trackError(error, {
          operation: 'eleven-create-track',
          correlationId,
          status: response.status,
          attempt,
          prompt: prompt.slice(0, 100)
        })
        
        throw error
      }

      // ElevenLabs returns the MP3 file directly, not JSON
      const audioBuffer = await response.arrayBuffer()
      const audioBufferData = Buffer.from(audioBuffer)

      logger.info('ElevenLabs track creation successful (synchronous)', {
        correlationId,
        audioSize: audioBufferData.length,
        duration: Date.now() - startTime,
        attempt
      })

      // Return the audio buffer directly since it's synchronous
      return {
        requestId: `sync_${correlationId}`, // Generate a fake request ID for compatibility
        audioBuffer: audioBufferData
      }

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      logger.warn('ElevenLabs request attempt failed', {
        correlationId,
        attempt,
        error: lastError.message
      })
      
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt - 1)
        await sleep(backoffMs)
        continue
      }
    }
  }
  
  // All attempts failed
  const finalError = lastError || new Error('ElevenLabs request failed after all retries')
  
  errorTracker.trackError(finalError, {
    operation: 'eleven-create-track',
    correlationId,
    attempts: MAX_RETRY_ATTEMPTS,
    prompt: prompt.slice(0, 100)
  })
  
  logger.error('ElevenLabs track creation failed', { correlationId }, finalError)
  throw finalError
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
 * Poll track generation status (with retry logic)
 */
export async function pollTrack({ requestId }: PollTrackParams): Promise<PollTrackResult> {
  const correlationId = generateCorrelationId()
  
  if (!ELEVEN_API_KEY) {
    throw new Error('ElevenLabs API key not configured')
  }

  logger.debug('Polling ElevenLabs track status', {
    correlationId,
    requestId
  })

  let lastError: Error | null = null
  
  // Retry polling with shorter retry count (it's called repeatedly)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${ELEVEN_BASE_URL}/music/${requestId}`, {
        headers: {
          'xi-api-key': ELEVEN_API_KEY,
          'User-Agent': 'Agent-DJ-Radio/1.0'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout for polling
      })

      if (!response.ok) {
        if (response.status === 404) {
          logger.warn('ElevenLabs generation request not found', {
            correlationId,
            requestId
          })
          
          return {
            status: 'failed',
            error: 'Generation request not found'
          }
        }
        
        const errorText = await response.text()
        const error = new Error(`ElevenLabs API error: ${response.status} ${errorText}`)
        
        // Retry on 429 or 5xx errors
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          lastError = error
          logger.warn('Retryable ElevenLabs poll error', {
            correlationId,
            requestId,
            attempt,
            status: response.status
          })
          
          await sleep(1000) // 1 second backoff for polling
          continue
        }
        
        throw error
      }

      const data = await response.json() as any
      
      // Map ElevenLabs status to our status
      let result: PollTrackResult
      switch (data.status) {
        case 'pending':
          result = { status: 'queued' }
          break
        case 'processing':
          result = { status: 'processing' }
          break
        case 'completed':
          result = { 
            status: 'ready', 
            audioUrl: data.audio_url 
          }
          break
        case 'failed':
          result = { 
            status: 'failed', 
            error: data.error || 'Generation failed' 
          }
          break
        default:
          result = { 
            status: 'failed', 
            error: `Unknown status: ${data.status}` 
          }
      }

      logger.debug('ElevenLabs poll result', {
        correlationId,
        requestId,
        status: result.status,
        hasAudioUrl: !!result.audioUrl
      })

      return result

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      if (attempt < 2) {
        await sleep(1000)
        continue
      }
    }
  }
  
  const finalError = lastError || new Error('ElevenLabs polling failed')
  
  errorTracker.trackError(finalError, {
    operation: 'eleven-poll-track',
    correlationId,
    requestId
  })
  
  throw finalError
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