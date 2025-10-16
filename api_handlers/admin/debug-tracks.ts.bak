import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'

async function debugTracksHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    // Get all tracks with their audio URLs
    const { data: tracks, error } = await supabaseAdmin
      .from('tracks')
      .select('id, prompt, audio_url, status, source, created_at')
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Error fetching tracks:', error)
      res.status(500).json({ error: 'Failed to fetch tracks' })
      return
    }

    // Also check what files are in the tracks bucket
    const { data: files, error: storageError } = await supabaseAdmin.storage
      .from('tracks')
      .list('', { limit: 10, sortBy: { column: 'created_at', order: 'desc' } })

    const debugInfo = {
      tracks: tracks || [],
      storage_files: files || [],
      storage_error: storageError
    }

    res.status(200).json(debugInfo)
  } catch (error) {
    console.error('Debug tracks error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

export default secureHandler(debugTracksHandler, securityConfigs.admin)