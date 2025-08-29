import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { getTracksByStatus, updateTrackStatus } from '../../src/server/db'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Get the oldest PAID track
    const paidTracks = await getTracksByStatus(supabaseAdmin, ['PAID'])
    
    if (paidTracks.length === 0) {
      return res.status(200).json({ 
        message: 'No tracks to generate',
        processed: false 
      })
    }

    const trackToGenerate = paidTracks[0] // Oldest first

    // Mock generation: update status to GENERATING then immediately to READY
    const generatingTrack = await updateTrackStatus(
      supabaseAdmin,
      trackToGenerate.id,
      'GENERATING'
    )

    if (!generatingTrack) {
      return res.status(500).json({ error: 'Failed to update track to GENERATING' })
    }

    // Mock audio generation - use sample track URL
    const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
    const mockAudioUrl = `${siteUrl}/sample-track.mp3`

    // Update to READY with mock audio URL
    const readyTrack = await updateTrackStatus(
      supabaseAdmin,
      trackToGenerate.id,
      'READY',
      {
        audio_url: mockAudioUrl,
        eleven_request_id: `mock_${trackToGenerate.id}_${Date.now()}`
      }
    )

    if (!readyTrack) {
      return res.status(500).json({ error: 'Failed to update track to READY' })
    }

    res.status(200).json({
      message: 'Track generated successfully',
      processed: true,
      track: readyTrack
    })
  } catch (error) {
    console.error('Generate track error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}