import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { claimNextPaidTrack, updateTrackStatus } from '../../src/server/db.js'
import { createTrack, pollTrackWithTimeout, fetchToBuffer } from '../../src/server/eleven.js'
import { uploadAudioBuffer, ensureTracksBucket } from '../../src/server/storage.js'
import { broadcastQueueUpdate } from '../../src/server/realtime.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { errorTracker, handleApiError } from '../../src/lib/error-tracking.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'

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
    
    // Claim next PAID track with concurrency control (idempotent operation)
    const trackToGenerate = await claimNextPaidTrack(supabaseAdmin)
    
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

    logger.trackStatusChanged(trackToGenerate.id, 'PAID', 'GENERATING', { 
      correlationId,
      elevenEnabled,
      prompt: trackToGenerate.prompt,
      duration: trackToGenerate.duration_seconds
    })

    // Update status to GENERATING (idempotent - won't double-process if already GENERATING)
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
      // Mock generation path - upload sample track to Supabase
      try {
        // Ensure storage bucket exists
        await ensureTracksBucket()
        
        // Read the sample track file
        const fs = await import('fs')
        const path = await import('path')
        const sampleTrackPath = path.join(process.cwd(), 'public', 'sample-track.wav')
        const audioBuffer = fs.readFileSync(sampleTrackPath)
        
        // Upload to Supabase Storage
        const { publicUrl } = await uploadAudioBuffer({
          trackId: trackToGenerate.id,
          audioBuffer
        })
        
        audioUrl = publicUrl.replace(/\s+/g, '').trim()
        elevenRequestId = `mock_${trackToGenerate.id}_${Date.now()}`
        
        logger.info('Mock audio uploaded to Supabase storage', { 
          correlationId, 
          trackId: trackToGenerate.id,
          audioUrl
        })
      } catch (error) {
        logger.error('Failed to upload mock audio to storage, falling back to local URL', {
          correlationId,
          trackId: trackToGenerate.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        
        // Fallback to local URL if storage upload fails
        const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
        audioUrl = `${siteUrl}/sample-track.wav`
        elevenRequestId = `mock_${trackToGenerate.id}_${Date.now()}`
      }
    } else {
      // Real ElevenLabs generation with fallback to mock
      usedFallback = false
      
      try {
        logger.info('Starting ElevenLabs generation', { 
          correlationId, 
          trackId: trackToGenerate.id,
          prompt: trackToGenerate.prompt,
          duration: trackToGenerate.duration_seconds
        })
        
        // Ensure storage bucket exists
        await ensureTracksBucket()
        
        // Start generation
        const result = await createTrack({
          prompt: trackToGenerate.prompt,
          durationSeconds: trackToGenerate.duration_seconds
        })
        
        elevenRequestId = result.requestId
        
        let audioBuffer: Buffer
        
        if (result.audioBuffer) {
          // Synchronous generation - audio is ready immediately
          logger.info('ElevenLabs synchronous generation completed', { 
            correlationId, 
            trackId: trackToGenerate.id,
            requestId: result.requestId,
            audioSize: result.audioBuffer.length
          })
          
          audioBuffer = result.audioBuffer
        } else {
          // Asynchronous generation - need to poll
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
          
          // Download audio
          audioBuffer = await fetchToBuffer(pollResult.audioUrl)
        }
        
        // Upload to Supabase Storage
        const { publicUrl } = await uploadAudioBuffer({
          trackId: trackToGenerate.id,
          audioBuffer
        })
        
        // Ensure the URL is clean (no newlines or extra whitespace)
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
        
        // Fallback to mock generation - upload sample track to Supabase
        try {
          // Ensure storage bucket exists
          await ensureTracksBucket()
          
          // Read the sample track file
          const fs = await import('fs')
          const path = await import('path')
          const sampleTrackPath = path.join(process.cwd(), 'public', 'sample-track.wav')
          const audioBuffer = fs.readFileSync(sampleTrackPath)
          
          // Upload to Supabase Storage
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
            audioUrl,
            originalError: error instanceof Error ? error.message : 'Unknown error'
          })
          
          // Track the fallback in error tracking for monitoring
          errorTracker.trackError(new Error('ElevenLabs generation failed, used fallback'), {
            operation: 'worker/generate-fallback',
            correlationId,
            trackId: trackToGenerate.id,
            elevenRequestId: elevenRequestId || null,
            originalError: error instanceof Error ? error.message : 'Unknown error'
          })
          
        } catch (fallbackError) {
          // If storage upload fails, try local URL fallback
          logger.warn('Storage upload failed, trying local URL fallback', {
            correlationId,
            trackId: trackToGenerate.id,
            fallbackError: fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
          })
          
          // Use local URL as final fallback
          const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
          audioUrl = `${siteUrl}/sample-track.wav`
          elevenRequestId = `fallback_${trackToGenerate.id}_${Date.now()}`
          usedFallback = true
          
          logger.info('Local URL fallback used due to storage failure', {
            correlationId,
            trackId: trackToGenerate.id,
            audioUrl,
            storageError: fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
          })
        }
      }
    }

    // Update to READY with audio URL (idempotent - final state)
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

    // Broadcast final status update
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