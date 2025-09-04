import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { getStationState, getTracksByStatus } from '../../src/server/db'
import { calculatePlayhead } from '../../src/server/station'
import { secureHandler, securityConfigs } from '../_shared/secure-handler'
import { sanitizeForClient } from '../_shared/security'
import type { StationStateResponse } from '../../src/types'

async function stationStateHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Get station state with current track
    const stationState = await getStationState(supabaseAdmin)
    if (!stationState) {
      return res.status(500).json({ error: 'Failed to get station state' })
    }

    // Calculate current playhead
    const playheadSeconds = calculatePlayhead(stationState)

    // Get queue (READY and PAID tracks)
    const queueTracks = await getTracksByStatus(supabaseAdmin, ['READY', 'PAID', 'GENERATING'])

    // Sanitize tracks before sending to client
    const sanitizedQueue = queueTracks.map(track => 
      sanitizeForClient(track, ['eleven_request_id'])
    )

    // Sanitize station state
    const sanitizedStationState = stationState.current_track 
      ? {
          ...stationState,
          current_track: sanitizeForClient(stationState.current_track, ['eleven_request_id'])
        }
      : stationState

    const response: StationStateResponse = {
      station_state: sanitizedStationState,
      queue: sanitizedQueue,
      playhead_seconds: playheadSeconds
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Get station state error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// Export with security middleware
export default secureHandler(stationStateHandler, securityConfigs.public)