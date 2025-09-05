#!/usr/bin/env node

/**
 * Simple dev API server that proxies to working API endpoints
 * Serves API endpoints at http://localhost:3001/api/*
 */

import { createServer } from 'http'
import { parse } from 'url'

const PORT = 3001

// Simple in-memory responses for development
const mockResponses = {
  '/api/station/state': {
    current_track: null,
    queue: [],
    playhead_seconds: 0,
    last_updated: new Date().toISOString()
  },
  '/api/admin/debug-tracks': {
    tracks: [],
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