import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdminAuth } from '../_shared/admin-auth.js'
import { supabaseAdmin } from '../_shared/supabase.js'
import { claimNextPaidTrack, updateTrackStatus } from '../../src/server/db.js'
import { createTrack, pollTrackWithTimeout, fetchToBuffer } from '../../src/server/eleven.js'
import { uploadAudioBuffer, ensureTracksBucket } from '../../src/server/storage.js'
import { broadcastQueueUpdate } from '../../src/server/realtime.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Admin authentication
  const authError = requireAdminAuth(req)
  if (authError === 'NOT_FOUND') {
    return res.status(404).json({ error: 'Not found' })
  }
  if (authError) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const elevenEnabled = process.env.ENABLE_REAL_ELEVEN === 'true'
    
    // Claim next PAID track with concurrency control
    const trackToGenerate = await claimNextPaidTrack(supabaseAdmin)
    
    if (!trackToGenerate) {
      return res.status(200).json({ 
        message: 'No tracks to generate',
        processed: false 
      })
    }

    console.log(`Admin: Processing track ${trackToGenerate.id} with ElevenLabs=${elevenEnabled}`)

    // Update status to GENERATING
    const generatingTrack = await updateTrackStatus(
      supabaseAdmin,
      trackToGenerate.id,
      'GENERATING'
    )

    if (!generatingTrack) {
      return res.status(500).json({ error: 'Failed to update track to GENERATING' })
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
        elevenRequestId = `admin_mock_${trackToGenerate.id}_${Date.now()}`
        
        console.log('Admin: Mock audio uploaded to Supabase storage:', audioUrl)
      } catch (error) {
        console.warn('Admin: Failed to upload mock audio to storage, using local URL fallback:', error)
        
        // Fallback to local URL if storage upload fails
        const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
        audioUrl = `${siteUrl}/sample-track.wav`
        elevenRequestId = `admin_mock_${trackToGenerate.id}_${Date.now()}`
      }
    } else {
      // Real ElevenLabs generation
      try {
        console.log('Admin: Starting ElevenLabs generation...')
        
        // Ensure storage bucket exists
        await ensureTracksBucket()
        
        // Start generation
        const { requestId } = await createTrack({
          prompt: trackToGenerate.prompt,
          durationSeconds: trackToGenerate.duration_seconds
        })
        
        elevenRequestId = requestId
        
        // Poll for completion with timeout
        const pollResult = await pollTrackWithTimeout({ requestId })
        
        if (pollResult.status === 'failed' || !pollResult.audioUrl) {
          throw new Error(pollResult.error || 'Generation failed')
        }
        
        console.log('Admin: Generation complete, downloading audio...')
        
        // Download audio
        const audioBuffer = await fetchToBuffer(pollResult.audioUrl)
        
        // Upload to Supabase Storage
        const { publicUrl } = await uploadAudioBuffer({
          trackId: trackToGenerate.id,
          audioBuffer
        })
        
        audioUrl = publicUrl
        console.log('Admin: Audio uploaded to storage:', publicUrl)
        
      } catch (error) {
        console.error('Admin: ElevenLabs generation failed:', error)
        
        // Mark track as FAILED
        await updateTrackStatus(
          supabaseAdmin,
          trackToGenerate.id,
          'FAILED',
          {
            eleven_request_id: elevenRequestId || null
          }
        )
        
        return res.status(200).json({
          message: 'Track generation failed',
          processed: true,
          error: error instanceof Error ? error.message : 'Generation failed',
          track_id: trackToGenerate.id
        })
      }
    }

    // Update to READY with audio URL
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
      return res.status(500).json({ error: 'Failed to update track to READY' })
    }

    // Broadcast final status update
    await broadcastQueueUpdate({
      queue: [readyTrack],
      action: 'updated',
      trackId: readyTrack.id
    })

    res.status(200).json({
      message: 'Track generated successfully',
      processed: true,
      track: readyTrack,
      eleven_enabled: elevenEnabled
    })
    
  } catch (error) {
    console.error('Admin generate track error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}