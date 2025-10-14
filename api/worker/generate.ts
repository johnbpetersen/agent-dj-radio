import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { updateTrackStatus } from '../../src/server/db.js'
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
  const deQuoted = noLyricsBlock.replace(/^[`"'""''\s]+|[`"'""''\s]+$/g, '').trim()

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
 * Helper to check if a URL is reachable via HEAD request
 */
async function headOk(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    return resp.ok;
  } catch {
    return false;
  }
}

async function generateHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Temporarily disabled in dev
  if (process.env.DISABLE_GENERATE_WORKER === 'true') {
    res.status(501).json({ message: 'generate worker disabled in dev' })
    return
  }

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

    // Atomically claim next job with FOR UPDATE SKIP LOCKED (prevents double-processing)
    const { data: jobs, error: jobsErr } = await supabaseAdmin.rpc('claim_next_job', {
      p_kind: 'generate'
    })

    if (jobsErr) {
      logger.error('worker/generate failed to claim job', { correlationId }, jobsErr)
      res.status(500).json({ error: 'Failed to claim job' })
      return
    }

    if (!jobs || jobs.length === 0) {
      const duration = Date.now() - startTime
      logger.cronJobComplete('worker/generate', duration, {
        correlationId,
        processed: false,
        reason: 'no_jobs_to_process'
      })

      res.status(200).json({
        message: 'No jobs to process',
        processed: false,
        correlationId
      })
      return
    }

    const job = jobs[0]

    // Load track details
    const { data: track, error: trackErr } = await supabaseAdmin
      .from('tracks')
      .select('id, prompt, augmented_prompt, duration_seconds, status, submitter_user_id')
      .eq('id', job.track_id)
      .single()

    if (trackErr || !track) {
      logger.error('worker/generate failed to load track', { correlationId, trackId: job.track_id }, trackErr)
      // Mark job as failed
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'failed', error: { message: 'Track not found' } })
        .eq('id', job.id)
      res.status(500).json({ error: 'Track not found' })
      return
    }

    logger.info('worker/generate processing job', {
      correlationId,
      jobId: job.id,
      trackId: track.id,
      userId: track.submitter_user_id,
      attempt: job.attempts
    })

    // Use augmented_prompt if available, otherwise fall back to original prompt
    const promptToUse = track.augmented_prompt || track.prompt
    const effectivePrompt = buildInstrumentalPrompt(promptToUse)

    logger.trackStatusChanged(track.id, 'QUEUED', 'GENERATING', {
      correlationId,
      elevenEnabled,
      prompt: track.prompt,
      augmentedPrompt: track.augmented_prompt,
      effectivePrompt, // Log what we'll actually send
      duration: track.duration_seconds
    })

    // Move QUEUED -> GENERATING
    const generatingTrack = await updateTrackStatus(
      supabaseAdmin,
      track.id,
      'GENERATING'
    )

    if (!generatingTrack) {
      logger.error('worker/generate failed to update track to GENERATING', { correlationId, trackId: track.id })
      // Mark job as failed
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'failed', error: { message: 'Failed to update track status' } })
        .eq('id', job.id)
      throw new Error(`Failed to update track ${track.id} to GENERATING status`)
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
      // Mock path (uploads sample) — prompt contents don't change output,
      // but we still log them for audit clarity.
      try {
        await ensureTracksBucket()

        const fs = await import('fs')
        const path = await import('path')
        const sampleTrackPath = path.join(process.cwd(), 'public', 'sample-track.wav')
        const audioBuffer = fs.readFileSync(sampleTrackPath)

        const { publicUrl } = await uploadAudioBuffer({
          trackId: track.id,
          audioBuffer
        })

        audioUrl = publicUrl.replace(/\s+/g, '').trim()
        elevenRequestId = `mock_${track.id}_${Date.now()}`

        const reachable = await headOk(audioUrl);
        if (!reachable) {
          logger.error('Storage HEAD check failed for uploaded audio', {
            correlationId,
            trackId: track.id,
            audioUrl
          });
          // Throw to enter the existing fallback block (local URL)
          throw new Error('storage_head_failed');
        }
        logger.info('Storage HEAD check passed', { correlationId, trackId: track.id, audioUrl });

        logger.info('Mock audio uploaded to Supabase storage', {
          correlationId,
          trackId: track.id,
          audioUrl,
          effectivePrompt
        })
      } catch (error) {
        logger.error('Failed to upload mock audio to storage, falling back to local URL', {
          correlationId,
          trackId: track.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        })

        const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
        audioUrl = `${siteUrl}/sample-track.wav`
        elevenRequestId = `mock_${track.id}_${Date.now()}`

        const fallbackReachable = await headOk(audioUrl);
        if (!fallbackReachable) {
          logger.error('Fallback storage HEAD check failed; aborting READY state', {
            correlationId,
            trackId: track.id,
            audioUrl
          });
          // Surface a controlled error; the outer catch will handle and return a 500.
          throw new Error('fallback_storage_head_failed');
        }
        logger.info('Fallback storage HEAD check passed', { correlationId, trackId: track.id, audioUrl });
      }
    } else {
      // Real ElevenLabs generation
      usedFallback = false

      try {
        logger.info('Starting ElevenLabs generation', {
          correlationId,
          trackId: track.id,
          // DO NOT send the raw prompt to the provider; only log it here.
          effectivePrompt,
          duration: track.duration_seconds
        })

        await ensureTracksBucket()

        // IMPORTANT: pass the effective (instrumental) prompt to the provider
        const result = await createTrack({
          prompt: effectivePrompt,
          durationSeconds: track.duration_seconds
        })

        elevenRequestId = result.requestId

        let audioBuffer: Buffer

        if (result.audioBuffer) {
          logger.info('ElevenLabs synchronous generation completed', {
            correlationId,
            trackId: track.id,
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
            trackId: track.id,
            requestId: result.requestId,
            status: pollResult.status
          })

          audioBuffer = await fetchToBuffer(pollResult.audioUrl)
        }

        const { publicUrl } = await uploadAudioBuffer({
          trackId: track.id,
          audioBuffer
        })

        audioUrl = publicUrl.replace(/\s+/g, '').trim()

        const reachable = await headOk(audioUrl);
        if (!reachable) {
          logger.error('Storage HEAD check failed for uploaded audio', {
            correlationId,
            trackId: track.id,
            audioUrl
          });
          // Throw to enter the existing fallback block (mock upload / local URL). Do NOT mark READY here.
          throw new Error('storage_head_failed');
        }
        logger.info('Storage HEAD check passed', { correlationId, trackId: track.id, audioUrl });

        logger.info('Audio uploaded to storage', {
          correlationId,
          trackId: track.id,
          publicUrl: audioUrl
        })
      } catch (error) {
        logger.warn('ElevenLabs generation failed, attempting fallback to mock', {
          correlationId,
          trackId: track.id,
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
            trackId: track.id,
            audioBuffer
          })

          audioUrl = publicUrl.replace(/\s+/g, '').trim()
          elevenRequestId = `fallback_${track.id}_${Date.now()}`
          usedFallback = true

          const fallbackReachable = await headOk(audioUrl);
          if (!fallbackReachable) {
            logger.error('Fallback storage HEAD check failed; aborting READY state', {
              correlationId,
              trackId: track.id,
              audioUrl
            });
            // Surface a controlled error; the outer catch will handle and return a 500.
            throw new Error('fallback_storage_head_failed');
          }
          logger.info('Fallback storage HEAD check passed', { correlationId, trackId: track.id, audioUrl });

          logger.info('Fallback mock audio uploaded to Supabase storage', {
            correlationId,
            trackId: track.id,
            audioUrl
          })

          errorTracker.trackError(new Error('ElevenLabs generation failed, used fallback'), {
            operation: 'worker/generate-fallback',
            correlationId,
            trackId: track.id,
            elevenRequestId: elevenRequestId || null,
            originalError: error instanceof Error ? error.message : 'Unknown error'
          })
        } catch (fallbackError) {
          logger.warn('Storage upload failed, trying local URL fallback', {
            correlationId,
            trackId: track.id,
            fallbackError: fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
          })

          const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
          audioUrl = `${siteUrl}/sample-track.wav`
          elevenRequestId = `fallback_${track.id}_${Date.now()}`
          usedFallback = true

          const fallbackReachable = await headOk(audioUrl);
          if (!fallbackReachable) {
            logger.error('Fallback storage HEAD check failed; aborting READY state', {
              correlationId,
              trackId: track.id,
              audioUrl
            });
            // Surface a controlled error; the outer catch will handle and return a 500.
            throw new Error('fallback_storage_head_failed');
          }
          logger.info('Fallback storage HEAD check passed', { correlationId, trackId: track.id, audioUrl });

          logger.info('Local URL fallback used due to storage failure', {
            correlationId,
            trackId: track.id,
            audioUrl
          })
        }
      }
    }

    // Move GENERATING -> READY
    const readyTrack = await updateTrackStatus(
      supabaseAdmin,
      track.id,
      'READY',
      {
        audio_url: audioUrl,
        eleven_request_id: elevenRequestId
      }
    )

    if (!readyTrack) {
      throw new Error(`Failed to update track ${track.id} to READY status`)
    }

    logger.trackStatusChanged(track.id, 'GENERATING', 'READY', {
      correlationId,
      audioUrl,
      elevenRequestId,
      usedFallback: usedFallback || false
    })

    // Mark job as succeeded
    const { error: succeededUpdateErr } = await supabaseAdmin
      .from('jobs')
      .update({
        status: 'succeeded',
        external_ref: elevenRequestId,
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)

    if (succeededUpdateErr) {
      logger.warn('worker/generate failed to mark job succeeded (non-fatal)', { correlationId, jobId: job.id }, succeededUpdateErr)
    }

    await broadcastQueueUpdate({
      queue: [readyTrack],
      action: 'updated',
      trackId: readyTrack.id
    })

    logger.info('worker/generate job completed successfully', {
      correlationId,
      jobId: job.id,
      trackId: track.id,
      durationMs: Date.now() - startTime
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
      jobId: job.id,
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