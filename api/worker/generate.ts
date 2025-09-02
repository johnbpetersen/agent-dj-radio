import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { claimNextPaidTrack, updateTrackStatus } from '../../src/server/db'
import { createTrack, pollTrackWithTimeout, fetchToBuffer } from '../../src/server/eleven'
import { uploadAudioBuffer, ensureTracksBucket } from '../../src/server/storage'
import { broadcastQueueUpdate } from '../../src/server/realtime'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
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

    console.log(`Processing track ${trackToGenerate.id} with ElevenLabs=${elevenEnabled}`)

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
      // Mock generation path
      const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
      audioUrl = `${siteUrl}/sample-track.mp3`
      elevenRequestId = `mock_${trackToGenerate.id}_${Date.now()}`
      
      console.log('Using mock audio generation')
    } else {
      // Real ElevenLabs generation
      try {
        console.log('Starting ElevenLabs generation...')
        
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
        
        console.log('Generation complete, downloading audio...')
        
        // Download audio
        const audioBuffer = await fetchToBuffer(pollResult.audioUrl)
        
        // Upload to Supabase Storage
        const { publicUrl } = await uploadAudioBuffer({
          trackId: trackToGenerate.id,
          audioBuffer
        })
        
        audioUrl = publicUrl
        console.log('Audio uploaded to storage:', publicUrl)
        
      } catch (error) {
        console.error('ElevenLabs generation failed:', error)
        
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
    console.error('Generate track error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}