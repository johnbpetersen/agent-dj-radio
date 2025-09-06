import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { claimNextPaidTrack, updateTrackStatus } from '../../src/server/db.js'
import { createTrack, pollTrackWithTimeout, fetchToBuffer } from '../../src/server/eleven.js'
import { uploadAudioBuffer, ensureTracksBucket } from '../../src/server/storage.js'
import { broadcastQueueUpdate } from '../../src/server/realtime.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { errorTracker, handleApiError } from '../../src/lib/error-tracking.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'

/**
 * Build a safe, provider-friendly prompt that enforces instrumental-only.
 * - Strips explicit "lyrics:" blocks if present
 * - Appends a strong no-vocals constraint
 * - Keeps length under ~500 chars (defensive)
 */
function buildInstrumentalPrompt(input: string): string {
  const raw = (input ?? '').trim()

  // Remove any trailing "lyrics: ..." user-provided text blocks
  const noLyricsBlock = raw.replace(/lyrics\s*:\s*[\s\S]*$/i, '').trim()

  // If user pasted an entire quoted lyric, try to collapse it (defensive, low risk)
  const deQuoted = noLyricsBlock.replace(/^[`"'“”‘’\s]+|[`"'“”‘’\s]+$/g, '').trim()

  // Always append explicit constraint; also add "instrumental" keyword for models that scan keywords
  const suffix = ' — instrumental only, no vocals, no singing, no speech'
  let out = deQuoted
  if (!/\binstrumental\b/i.test(out)) out = `${out} instrumental`
  out = `${out}${suffix}`

  // Hard cap (defensive). Keep room for suffix.
  if (out.length > 500) {
    const keep = Math.max(0, 480 - suffix.length)
    out = `${out.slice(0, keep)}${suffix}`
  }
  return out
}

/**
 * Targeted claim helper:
 * Try to fetch a specific track that is currently PAID.
 * (Read-only; the state transition happens via updateTrackStatus)
 */
async function claimPaidTrackById(trackId: string) {
  const { data, error } = await supabaseAdmin
    .from('tracks')
    .select('id, prompt, duration_seconds, status')
    .eq('id', trackId)
    .eq('status', 'PAID')
    .maybeSingle()

  if (error) {
    logger.error('claimPaidTrackById select error', { trackId, error: error.message })
    return null
  }
  return data || null
}

async function generateHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()
  let usedFallback = false

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  logger.cronJobStart('worker/generate', { correlationId })

  try {
    const elevenEnabled = process.env.ENABLE_REAL_ELEVEN === 'true'

    // Prefer the just-paid track if provided
    const forcedId =
      (req.query?.track_id as string | undefined) ||
      (typeof req.body === 'object' && req.body && (req.body as any).track_id)

    let trackToGenerate: any | null = null

    if (forcedId) {
      trackToGenerate = await claimPaidTrackById(forcedId)
      if (trackToGenerate) {
        logger.info('Targeted claim succeeded (PAID track found)', {
          correlationId,
          trackId: trackToGenerate.id
        })
      } else {
        logger.info('Targeted claim did not find PAID track, falling back to FIFO', {
          correlationId,
          forcedId
        })
      }
    }

    // FIFO fallback
    if (!trackToGenerate) {
      trackToGenerate = await claimNextPaidTrack(supabaseAdmin)
    }

    if (!trackToGenerate) {
      const duration = Date.now() - startTime
      logger.cronJobComplete('worker/generate', duration, {
        correlationId,
        processed: false,
        reason: 'no_paid_tracks'
      })

      res.status(200).json({
        message: 'No tracks to generate',
        processed: false,
        correlationId
      })
      return
    }

    // Enforce instrumental prompt here (server-side canonical place)
    const effectivePrompt = buildInstrumentalPrompt(trackToGenerate.prompt)

    logger.trackStatusChanged(trackToGenerate.id, 'PAID', 'GENERATING', {
      correlationId,
      elevenEnabled,
      prompt: trackToGenerate.prompt,
      effectivePrompt, // Log what we’ll actually send
      duration: trackToGenerate.duration_seconds
    })

    // Move PAID -> GENERATING
    const generatingTrack = await updateTrackStatus(
      supabaseAdmin,
      trackToGenerate.id,
      'GENERATING'
    )

    if (!generatingTrack) {
      throw new Error(`Failed to update track ${trackToGenerate.id} to GENERATING status`)
    }

    // Broadcast status update
    await broadcastQueueUpdate({
      queue: [generatingTrack],
      action: 'updated',
      trackId: generatingTrack.id
    })

    let audioUrl: string
    let elevenRequestId: string

    if (!elevenEnabled) {
      // Mock path (uploads sample) — prompt contents don’t change output,
      // but we still log them for audit clarity.
      try {
        await ensureTracksBucket()

        const fs = await import('fs')
        const path = await import('path')
        const sampleTrackPath = path.join(process.cwd(), 'public', 'sample-track.wav')
        const audioBuffer = fs.readFileSync(sampleTrackPath)

        const { publicUrl } = await uploadAudioBuffer({
          trackId: trackToGenerate.id,
          audioBuffer
        })

        audioUrl = publicUrl.replace(/\s+/g, '').trim()
        elevenRequestId = `mock_${trackToGenerate.id}_${Date.now()}`

        logger.info('Mock audio uploaded to Supabase storage', {
          correlationId,
          trackId: trackToGenerate.id,
          audioUrl,
          effectivePrompt
        })
      } catch (error) {
        logger.error('Failed to upload mock audio to storage, falling back to local URL', {
          correlationId,
          trackId: trackToGenerate.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        })

        const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
        audioUrl = `${siteUrl}/sample-track.wav`
        elevenRequestId = `mock_${trackToGenerate.id}_${Date.now()}`
      }
    } else {
      // Real ElevenLabs generation
      usedFallback = false

      try {
        logger.info('Starting ElevenLabs generation', {
          correlationId,
          trackId: trackToGenerate.id,
          // DO NOT send the raw prompt to the provider; only log it here.
          effectivePrompt,
          duration: trackToGenerate.duration_seconds
        })

        await ensureTracksBucket()

        // IMPORTANT: pass the effective (instrumental) prompt to the provider
        const result = await createTrack({
          prompt: effectivePrompt,
          durationSeconds: trackToGenerate.duration_seconds
        })

        elevenRequestId = result.requestId

        let audioBuffer: Buffer

        if (result.audioBuffer) {
          logger.info('ElevenLabs synchronous generation completed', {
            correlationId,
            trackId: trackToGenerate.id,
            requestId: result.requestId,
            audioSize: result.audioBuffer.length
          })
          audioBuffer = result.audioBuffer
        } else {
          const pollResult = await pollTrackWithTimeout({ requestId: result.requestId })

          if (pollResult.status === 'failed' || !pollResult.audioUrl) {
            throw new Error(pollResult.error || 'ElevenLabs generation failed')
          }

          logger.info('ElevenLabs asynchronous generation completed', {
            correlationId,
            trackId: trackToGenerate.id,
            requestId: result.requestId,
            status: pollResult.status
          })

          audioBuffer = await fetchToBuffer(pollResult.audioUrl)
        }

        const { publicUrl } = await uploadAudioBuffer({
          trackId: trackToGenerate.id,
          audioBuffer
        })

        audioUrl = publicUrl.replace(/\s+/g, '').trim()

        logger.info('Audio uploaded to storage', {
          correlationId,
          trackId: trackToGenerate.id,
          publicUrl: audioUrl
        })
      } catch (error) {
        logger.warn('ElevenLabs generation failed, attempting fallback to mock', {
          correlationId,
          trackId: trackToGenerate.id,
          elevenRequestId: elevenRequestId || null,
          error: error instanceof Error ? error.message : 'Unknown error'
        })

        try {
          await ensureTracksBucket()

          const fs = await import('fs')
          const path = await import('path')
          const sampleTrackPath = path.join(process.cwd(), 'public', 'sample-track.wav')
          const audioBuffer = fs.readFileSync(sampleTrackPath)

          const { publicUrl } = await uploadAudioBuffer({
            trackId: trackToGenerate.id,
            audioBuffer
          })

          audioUrl = publicUrl.replace(/\s+/g, '').trim()
          elevenRequestId = `fallback_${trackToGenerate.id}_${Date.now()}`
          usedFallback = true

          logger.info('Fallback mock audio uploaded to Supabase storage', {
            correlationId,
            trackId: trackToGenerate.id,
            audioUrl
          })

          errorTracker.trackError(new Error('ElevenLabs generation failed, used fallback'), {
            operation: 'worker/generate-fallback',
            correlationId,
            trackId: trackToGenerate.id,
            elevenRequestId: elevenRequestId || null,
            originalError: error instanceof Error ? error.message : 'Unknown error'
          })
        } catch (fallbackError) {
          logger.warn('Storage upload failed, trying local URL fallback', {
            correlationId,
            trackId: trackToGenerate.id,
            fallbackError: fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
          })

          const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
          audioUrl = `${siteUrl}/sample-track.wav`
          elevenRequestId = `fallback_${trackToGenerate.id}_${Date.now()}`
          usedFallback = true

          logger.info('Local URL fallback used due to storage failure', {
            correlationId,
            trackId: trackToGenerate.id,
            audioUrl
          })
        }
      }
    }

    // Move GENERATING -> READY
    const readyTrack = await updateTrackStatus(
      supabaseAdmin,
      trackToGenerate.id,
      'READY',
      {
        audio_url: audioUrl,
        eleven_request_id: elevenRequestId
      }
    )

    if (!readyTrack) {
      throw new Error(`Failed to update track ${trackToGenerate.id} to READY status`)
    }

    logger.trackStatusChanged(trackToGenerate.id, 'GENERATING', 'READY', {
      correlationId,
      audioUrl,
      elevenRequestId,
      usedFallback: usedFallback || false
    })

    await broadcastQueueUpdate({
      queue: [readyTrack],
      action: 'updated',
      trackId: readyTrack.id
    })

    const duration = Date.now() - startTime
    logger.cronJobComplete('worker/generate', duration, {
      correlationId,
      processed: true,
      result: 'success',
      trackId: readyTrack.id,
      elevenEnabled,
      usedFallback: usedFallback || false
    })

    res.status(200).json({
      message: 'Track generated successfully',
      processed: true,
      track: readyTrack,
      eleven_enabled: elevenEnabled,
      used_fallback: usedFallback || false,
      correlationId
    })
  } catch (error) {
    const duration = Date.now() - startTime
    const errorResponse = handleApiError(error, 'worker/generate', { correlationId })

    logger.cronJobComplete('worker/generate', duration, {
      correlationId,
      processed: false,
      result: 'error'
    })

    res.status(500).json(errorResponse)
  }
}

export default secureHandler(generateHandler, securityConfigs.worker)