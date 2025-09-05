import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'

async function fixAudioUrlsHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    // Get all tracks with broken URLs
    const { data: tracks, error } = await supabaseAdmin
      .from('tracks')
      .select('id, audio_url')
      .not('audio_url', 'is', null)

    if (error) {
      console.error('Error fetching tracks:', error)
      res.status(500).json({ error: 'Failed to fetch tracks' })
      return
    }

    const fixes = []
    
    for (const track of tracks || []) {
      let needsUpdate = false
      let newUrl = track.audio_url
      
      // Fix whitespace issues
      if (track.audio_url && (track.audio_url.includes('\n') || track.audio_url.includes('  '))) {
        newUrl = track.audio_url.replace(/\n\s*/g, '').replace(/\s+/g, ' ').trim()
        needsUpdate = true
      }
      
      // Fix local URLs to use proper Supabase storage
      if (track.audio_url && (track.audio_url.startsWith('/sample-track') || track.audio_url.includes('localhost'))) {
        try {
          // Upload sample track to Supabase Storage for this track
          const fs = await import('fs')
          const path = await import('path')
          const sampleTrackPath = path.join(process.cwd(), 'public', 'sample-track.wav')
          const audioBuffer = fs.readFileSync(sampleTrackPath)
          
          const { uploadAudioBuffer } = await import('../../src/server/storage.js')
          const { publicUrl } = await uploadAudioBuffer({
            trackId: track.id,
            audioBuffer
          })
          
          newUrl = publicUrl.replace(/\s+/g, '').trim()
          needsUpdate = true
          
          console.log(`Converting local URL to Supabase storage for track ${track.id}:`)
          console.log(`  OLD: ${track.audio_url}`)
          console.log(`  NEW: ${newUrl}`)
        } catch (uploadError) {
          console.error(`Failed to upload sample track for ${track.id}:`, uploadError)
          // Keep the old URL if upload fails
          needsUpdate = false
        }
      }
      
      if (needsUpdate && newUrl !== track.audio_url) {
        console.log(`Fixing URL for track ${track.id}:`)
        console.log(`  OLD: ${track.audio_url}`)
        console.log(`  NEW: ${newUrl}`)
        
        // Update the track
        const { error: updateError } = await supabaseAdmin
          .from('tracks')
          .update({ audio_url: newUrl })
          .eq('id', track.id)
        
        if (updateError) {
          console.error(`Failed to update track ${track.id}:`, updateError)
        } else {
          fixes.push({
            track_id: track.id,
            old_url: track.audio_url,
            new_url: newUrl
          })
        }
      }
    }

    res.status(200).json({
      message: `Fixed ${fixes.length} audio URLs`,
      fixes
    })

  } catch (error) {
    console.error('Fix audio URLs error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

export default secureHandler(fixAudioUrlsHandler, securityConfigs.admin)