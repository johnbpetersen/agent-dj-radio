#!/usr/bin/env node

/**
 * Simple dev API server that proxies to working API endpoints
 * Serves API endpoints at http://localhost:3001/api/*
 */

import { createServer } from 'http'
import { parse } from 'url'

const PORT = 3001

// Simple in-memory responses for development
const mockTrack = {
  id: 'test-track-1',
  prompt: 'A funky electronic beat with synthesizers',
  user_id: 'test-user',
  status: 'READY',
  source: 'MANUAL',
  duration_seconds: 60,
  audio_url: '/sample-track.wav',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  eleven_request_id: null,
  rating_score: 4.2,
  rating_count: 5,
  user: {
    id: 'test-user',
    display_name: 'Test User',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

const mockResponses = {
  '/api/station/state': {
    station_state: {
      id: 1,
      current_track_id: mockTrack.id,
      current_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_track: mockTrack
    },
    queue: [mockTrack],
    playhead_seconds: 0
  },
  '/api/admin/debug-tracks': {
    tracks: [mockTrack],
    storage_files: [],
    storage_error: null
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = parse(req.url)
  
  // Enable CORS for development
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }
  
  console.log(`📡 ${req.method} ${pathname}`)
  
  // Handle mock endpoints
  if (mockResponses[pathname]) {
    res.setHeader('Content-Type', 'application/json')
    res.writeHead(200)
    res.end(JSON.stringify(mockResponses[pathname]))
    return
  }
  
  // Handle 404
  res.setHeader('Content-Type', 'application/json')
  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found', path: pathname }))
})

server.listen(PORT, () => {
  console.log(`🚀 Simple Dev API server running on http://localhost:${PORT}`)
  console.log(`📡 Available endpoints:`)
  Object.keys(mockResponses).forEach(path => {
    console.log(`   GET http://localhost:${PORT}${path}`)
  })
})