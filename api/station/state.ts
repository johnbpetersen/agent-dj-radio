import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_shared/supabase'
import { getStationState, getTracksByStatus } from '../../src/server/db'
import { calculatePlayhead } from '../../src/server/station'
import type { StationStateResponse } from '../../src/types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    const response: StationStateResponse = {
      station_state: stationState,
      queue: queueTracks,
      playhead_seconds: playheadSeconds
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Get station state error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}