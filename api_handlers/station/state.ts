// api/station/state.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import supabase from '../_shared/supabase.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { httpError, type ErrorMeta } from '../_shared/errors.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'

const STATION_ID = Number(process.env.STATION_ID || '1')

// remove sensitive/internal fields before sending to client
function sanitizeTrack<T extends Record<string, unknown>>(track: T | null): T | null {
  if (!track) return track
  const copy: Record<string, unknown> = { ...track }
  delete copy.eleven_request_id
  return copy as T
}

async function stationStateHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    throw httpError.badRequest('Method not allowed', 'Only GET requests are supported')
  }

  res.setHeader('Cache-Control', 'no-store')

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  // 1) Load station_state
    const { data: state, error: stateErr } = await supabase
      .from('station_state')
      .select('id,current_track_id,current_started_at,updated_at')
      .eq('id', STATION_ID)
      .single()

    if (stateErr) {
      const context: ErrorMeta['context'] = {
        route: '/api/station/state',
        method: 'GET',
        path: req.url,
        queryKeysOnly: req.query ? Object.keys(req.query) : [],
        targetUrl: 'supabase://station_state'
      }
      logger.error('Station state query failed', { correlationId, ...context }, stateErr)
      throw httpError.dbError('Failed to load station state', {
        db: { type: 'QUERY', operation: 'select', table: 'station_state' },
        context
      })
    }
    if (!state) {
      throw httpError.notFound('Station state not found', `Station ID ${STATION_ID} does not exist`)
    }

    // 2) All playable tracks (anything with a real audio_url)
    const { data: playable, error: playableErr } = await supabase
      .from('tracks')
      .select('*')
      .not('audio_url', 'is', null)
      .neq('audio_url', '')
      .order('created_at', { ascending: true })
      .limit(500)

    if (playableErr) {
      const context: ErrorMeta['context'] = {
        route: '/api/station/state',
        method: 'GET',
        path: req.url,
        queryKeysOnly: req.query ? Object.keys(req.query) : [],
        targetUrl: 'supabase://tracks'
      }
      logger.error('Playable tracks query failed', { correlationId, ...context }, playableErr)
      throw httpError.dbError('Failed to load tracks', {
        db: { type: 'QUERY', operation: 'select', table: 'tracks' },
        context
      })
    }

    const playableArr = (playable ?? []).map(sanitizeTrack)

    // 3) Resolve the current track
    let currentTrack: Record<string, unknown> | null = null
    let currentTrackId: string | null | undefined = state.current_track_id as string | null
    let currentStartedAt = state.current_started_at as string | null

    if (currentTrackId) {
      const { data: trackRow, error: trackErr } = await supabase
        .from('tracks')
        .select('*')
        .eq('id', currentTrackId)
        .single()
      if (!trackErr && trackRow) currentTrack = sanitizeTrack(trackRow)
    }

    // If station has no current track, bootstrap it to the first playable, persist to DB
    if (!currentTrack && playableArr.length > 0) {
      const first = playableArr[0]
      currentTrack = first
      currentTrackId = first.id
      currentStartedAt = new Date().toISOString()

      // Persist station_state (and mark the chosen track as PLAYING if needed)
      const updates: Record<string, unknown> = {
        current_track_id: currentTrackId,
        current_started_at: currentStartedAt,
        updated_at: new Date().toISOString(),
      }

      const [{ error: upsertErr }, { error: markErr }] = await Promise.all([
        supabase
          .from('station_state')
          .update(updates)
          .eq('id', STATION_ID),
        supabase
          .from('tracks')
          .update({
            status: 'PLAYING',
            started_at: currentStartedAt,
            last_played_at: currentStartedAt,
          })
          .eq('id', currentTrackId),
      ])

      if (upsertErr) {
        logger.warn('Failed to persist station_state bootstrap', {
          correlationId,
          targetUrl: 'supabase://station_state',
          operation: 'update'
        }, upsertErr)
      }
      if (markErr) {
        logger.warn('Failed to mark current track PLAYING', {
          correlationId,
          targetUrl: 'supabase://tracks',
          operation: 'update',
          trackId: currentTrackId || undefined
        }, markErr)
      }
    }

    // 4) Build the queue: all other playable tracks, normalized to READY in the response
    const queue = playableArr
      .filter(t => currentTrackId ? t.id !== currentTrackId : true)
      .map(t => ({ ...t, status: 'READY' }))

    // 5) Playhead calculation
    let playhead_seconds = 0
    if (currentStartedAt) {
      const started = new Date(currentStartedAt).getTime()
      playhead_seconds = Math.max(0, Math.floor((Date.now() - started) / 1000))
    }

    logger.requestComplete('/api/station/state', Date.now() - startTime, {
      correlationId,
      currentTrackId,
      queueLength: queue.length,
      playheadSeconds: playhead_seconds
    })

    res.status(200).json({
      station_state: {
        id: state.id,
        current_track_id: currentTrackId,
        current_started_at: currentStartedAt,
        updated_at: state.updated_at,
        current_track: currentTrack ? { ...currentTrack, status: 'PLAYING' } : null,
      },
      queue,
      playhead_seconds,
    })
}

export default secureHandler(stationStateHandler, securityConfigs.public)