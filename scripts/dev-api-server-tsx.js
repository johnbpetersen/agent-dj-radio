#!/usr/bin/env node
/**
 * Simple DEV API server with in-memory data.
 * Serves endpoints your frontend expects on http://localhost:3001/api/*
 *
 * NOTE: This is ESM (package.json has "type":"module")
 */
import { createServer } from 'http'
import { parse } from 'url'

const PORT = 3001

// ----- Mock data ------------------------------------------------------------
function makeTrack(id, prompt) {
  const now = new Date().toISOString()
  return {
    id,
    prompt,
    user_id: 'mock-user',
    status: 'READY',
    source: 'MANUAL',
    duration_seconds: 60,
    audio_url: '/sample-track.wav', // make sure public/sample-track.wav exists
    created_at: now,
    updated_at: now,
    eleven_request_id: null,
    rating_score: 4.5,
    rating_count: 12,
    user: {
      id: 'mock-user',
      display_name: 'Test User',
      created_at: now,
      updated_at: now,
    },
  }
}

let currentTrack = makeTrack('test-track-1', 'Spanish guitar → deep jungle trance')
let queue = [makeTrack('test-track-2', 'Uplifting synthwave interlude')]

// when did the currentTrack start playing?
let currentStartedAt = Date.now() - 12_000 // 12s ago to show a running timer

function playheadSeconds() {
  return Math.max(0, Math.floor((Date.now() - currentStartedAt) / 1000))
}

// ----- Helpers --------------------------------------------------------------
function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end(JSON.stringify(data))
}

// ----- Server ---------------------------------------------------------------
const server = createServer(async (req, res) => {
  const { pathname } = parse(req.url || '', true)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  console.log(`📡 ${req.method} ${pathname}`)

  // GET /api/station/state  → what your UI polls
  if (req.method === 'GET' && pathname === '/api/station/state') {
    return json(res, 200, {
      station_state: {
        id: 1,
        current_track_id: currentTrack.id,
        current_started_at: new Date(currentStartedAt).toISOString(),
        updated_at: new Date().toISOString(),
        current_track: currentTrack,
      },
      queue,
      playhead_seconds: playheadSeconds(),
    })
  }

  // POST /api/station/advance → advance to next track (if any)
  if (req.method === 'POST' && pathname === '/api/station/advance') {
    const next = queue.shift()
    if (next) {
      currentTrack = { ...next, status: 'PLAYING' }
      currentStartedAt = Date.now()
      return json(res, 200, { ok: true, now_playing: currentTrack })
    }
    // no queue → restart the same track for demo
    currentStartedAt = Date.now()
    return json(res, 200, { ok: true, now_playing: currentTrack })
  }

  // GET /api/admin/debug-tracks → handy inspector
  if (req.method === 'GET' && pathname === '/api/admin/debug-tracks') {
    return json(res, 200, {
      tracks: [currentTrack, ...queue],
      storage_files: [],
      storage_error: null,
    })
  }

  // Fallback 404
  return json(res, 404, { error: 'Not found', path: pathname })
})

server.listen(PORT, () => {
  console.log(`🚀 Simple Dev API server running on http://localhost:${PORT}`)
  console.log(`📡 Available endpoints:`)
  console.log(`   GET  http://localhost:${PORT}/api/station/state`)
  console.log(`   POST http://localhost:${PORT}/api/station/advance`)
  console.log(`   GET  http://localhost:${PORT}/api/admin/debug-tracks`)
})