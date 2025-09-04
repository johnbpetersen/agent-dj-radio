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
      if (track.audio_url && (track.audio_url.includes('\n') || track.audio_url.includes('  '))) {
        // Clean up the URL by removing newlines and extra spaces
        const cleanUrl = track.audio_url.replace(/\n\s*/g, '')
        
        console.log(`Fixing URL for track ${track.id}:`)
        console.log(`  OLD: ${track.audio_url}`)
        console.log(`  NEW: ${cleanUrl}`)
        
        // Update the track
        const { error: updateError } = await supabaseAdmin
          .from('tracks')
          .update({ audio_url: cleanUrl })
          .eq('id', track.id)
        
        if (updateError) {
          console.error(`Failed to update track ${track.id}:`, updateError)
        } else {
          fixes.push({
            track_id: track.id,
            old_url: track.audio_url,
            new_url: cleanUrl
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