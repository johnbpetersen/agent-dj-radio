import type { VercelRequest, VercelResponse } from '@vercel/node'
import realHandler from '../../api_handlers/station/state' // no ".js" extension

// Single default export only — no other exports in this file.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Delegate to the real implementation
    return await (realHandler as any)(req, res)
  } catch (err: any) {
    // Never 500 in prod — return degraded state so UI can render
    console.error('[station/state] fallback', { error: err?.stack || String(err) })
    res.status(200).json({
      current_track: null,
      queue: [],
      playhead_seconds: 0,
      degraded: true,
      error_code: 'STATION_STATE_FETCH_FAILED'
    })
  }
}