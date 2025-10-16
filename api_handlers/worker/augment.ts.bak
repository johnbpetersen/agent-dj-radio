// POST /api/worker/augment
// Augmentation worker - polls jobs table for kind='augment', status='queued'
// MVP: Stub implementation that copies original_prompt → augmented_prompt
// Future: Integrate Daydreams Router for actual prompt augmentation

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

async function augmentHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  logger.info('worker/augment polling', { correlationId })

  try {
    // Atomically claim next job with FOR UPDATE SKIP LOCKED (prevents double-processing)
    const { data: jobs, error: jobsErr } = await supabaseAdmin.rpc('claim_next_job', {
      p_kind: 'augment'
    })

    if (jobsErr) {
      logger.error('worker/augment failed to claim job', { correlationId }, jobsErr)
      res.status(500).json({ error: 'Failed to claim job' })
      return
    }

    if (!jobs || jobs.length === 0) {
      logger.info('worker/augment no jobs to process', { correlationId })
      res.status(200).json({ message: 'No jobs to process', processed: 0 })
      return
    }

    const job = jobs[0]

    // Load track details
    const { data: track, error: trackErr } = await supabaseAdmin
      .from('tracks')
      .select('id, prompt, status, submitter_user_id')
      .eq('id', job.track_id)
      .single()

    if (trackErr || !track) {
      logger.error('worker/augment failed to load track', { correlationId, trackId: job.track_id }, trackErr)
      // Mark job as failed
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'failed', error: { message: 'Track not found' } })
        .eq('id', job.id)
      res.status(500).json({ error: 'Track not found' })
      return
    }

    logger.info('worker/augment processing job', {
      correlationId,
      jobId: job.id,
      trackId: track.id,
      userId: track.submitter_user_id,
      attempt: job.attempts
    })

    try {
      // ===================================================================
      // MVP STUB: Copy original_prompt → augmented_prompt (no external call)
      // TODO: Later integrate Daydreams Router here
      // ===================================================================
      const augmentedPrompt = track.prompt

      logger.info('worker/augment prompt augmented (stub)', {
        correlationId,
        jobId: job.id,
        trackId: track.id,
        promptLength: augmentedPrompt.length
      })

      // Update track with augmented prompt and transition to QUEUED
      const { error: trackUpdateErr } = await supabaseAdmin
        .from('tracks')
        .update({
          augmented_prompt: augmentedPrompt,
          status: 'QUEUED'
        })
        .eq('id', track.id)

      if (trackUpdateErr) {
        logger.error('worker/augment failed to update track', { correlationId, trackId: track.id }, trackUpdateErr)
        throw new Error(`Failed to update track: ${trackUpdateErr.message}`)
      }

      // Mark job as succeeded
      const { error: succeededUpdateErr } = await supabaseAdmin
        .from('jobs')
        .update({
          status: 'succeeded',
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      if (succeededUpdateErr) {
        logger.warn('worker/augment failed to mark job succeeded (non-fatal)', { correlationId, jobId: job.id }, succeededUpdateErr)
      }

      // Enqueue generation job
      const { error: generateJobErr } = await supabaseAdmin
        .from('jobs')
        .insert({
          track_id: track.id,
          kind: 'generate',
          status: 'queued'
        })

      if (generateJobErr) {
        logger.error('worker/augment failed to enqueue generate job', { correlationId, trackId: track.id }, generateJobErr)
        // Non-fatal - generation worker will handle missing jobs
      } else {
        logger.info('worker/augment generate job enqueued', {
          correlationId,
          trackId: track.id
        })
      }

      // Trigger generation worker (fire-and-forget)
      try {
        const baseUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
        const workerUrl = `${baseUrl}/api/worker/generate`
        fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }).catch(err => {
          logger.warn('worker/augment failed to trigger generate worker (non-blocking)', {
            correlationId,
            error: err?.message
          })
        })
      } catch (err) {
        logger.warn('worker/augment generate worker trigger error (non-blocking)', {
          correlationId,
          error: (err as Error)?.message
        })
      }

      logger.info('worker/augment job completed successfully', {
        correlationId,
        jobId: job.id,
        trackId: track.id,
        durationMs: Date.now() - startTime
      })

      res.status(200).json({
        ok: true,
        processed: 1,
        jobId: job.id,
        trackId: track.id
      })

    } catch (error) {
      // Job failed - mark as failed with error details
      const err = error instanceof Error ? error : new Error(String(error))

      logger.error('worker/augment job failed', {
        correlationId,
        jobId: job.id,
        trackId: track.id
      }, err)

      const { error: failedUpdateErr } = await supabaseAdmin
        .from('jobs')
        .update({
          status: 'failed',
          error: {
            message: err.message,
            stack: err.stack,
            timestamp: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      if (failedUpdateErr) {
        logger.error('worker/augment failed to mark job failed', { correlationId, jobId: job.id }, failedUpdateErr)
      }

      // Also mark track as FAILED
      await supabaseAdmin
        .from('tracks')
        .update({ status: 'FAILED' })
        .eq('id', track.id)

      res.status(500).json({
        error: 'Augmentation failed',
        jobId: job.id,
        trackId: track.id,
        message: err.message
      })
    }

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('worker/augment unhandled error', { correlationId }, err)

    res.status(500).json({
      error: 'Internal server error',
      message: err.message
    })
  }
}

export default secureHandler(augmentHandler, securityConfigs.admin)
