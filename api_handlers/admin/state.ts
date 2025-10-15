import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdminAuth } from '../_shared/admin-auth'
import { supabaseAdmin } from '../_shared/supabase.js'
import { getStationState, getTracksByStatus } from '../../src/server/db'
import { calculatePlayhead } from '../../src/server/station'
import { secureHandler, securityConfigs } from '../_shared/secure-handler'
import type { StationStateResponse } from '../../src/types'

async function adminStateHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
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
    // Get station state with current track
    const stationState = await getStationState(supabaseAdmin)
    if (!stationState) {
      return res.status(500).json({ error: 'Failed to get station state' })
    }

    // Calculate current playhead
    const playheadSeconds = calculatePlayhead(stationState)

    // Get queue (READY, PAID, GENERATING tracks for admin visibility)
    const queueTracks = await getTracksByStatus(supabaseAdmin, ['READY', 'PAID', 'GENERATING'])

    // Get recent DONE/FAILED tracks for admin visibility (last 10)
    const recentTracks = await getTracksByStatus(supabaseAdmin, ['DONE', 'FAILED'])
    const recentTracksLimited = recentTracks.slice(-10)

    const response: StationStateResponse & {
      recent_tracks: typeof recentTracksLimited
    } = {
      station_state: stationState,
      queue: queueTracks,
      playhead_seconds: playheadSeconds,
      recent_tracks: recentTracksLimited
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Admin get station state error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

export default secureHandler(adminStateHandler, securityConfigs.admin)