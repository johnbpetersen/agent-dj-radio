#!/usr/bin/env node

/**
 * Local development cron simulator
 * Calls worker/generate and station/advance endpoints periodically
 * Simulates production cron jobs for local development
 */

const SERVER_URL = process.env.VITE_SITE_URL || 'http://localhost:5173'
const INTERVAL_MS = 10000 // 10 seconds (faster than production for development)

console.log(`🔄 Starting local cron simulator`)
console.log(`📍 Server: ${SERVER_URL}`)
console.log(`⏱️  Interval: ${INTERVAL_MS}ms`)
console.log('')

let running = true

async function callEndpoint(path, name) {
  try {
    const response = await fetch(`${SERVER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    
    if (!response.ok) {
      console.log(`❌ ${name}: HTTP ${response.status}`)
      return
    }
    
    const result = await response.json()
    
    if (path === '/api/worker/generate') {
      if (result.processed) {
        console.log(`✅ ${name}: Processed track ${result.track?.id || 'unknown'}`)
      } else {
        console.log(`⏭️  ${name}: ${result.message}`)
      }
    } else if (path === '/api/station/advance') {
      if (result.advanced) {
        if (result.current_track) {
          console.log(`🎵 ${name}: Now playing "${result.current_track.prompt}" (${result.current_track.duration_seconds}s)`)
        } else {
          console.log(`🔇 ${name}: No tracks available`)
        }
      } else {
        console.log(`⏸️  ${name}: ${result.message}`)
      }
    }
  } catch (error) {
    console.log(`💥 ${name}: ${error.message}`)
  }
}

async function runCronCycle() {
  console.log(`\n🔄 Running cron cycle at ${new Date().toLocaleTimeString()}`)
  
  // First process any PAID tracks -> READY
  await callEndpoint('/api/worker/generate', 'Worker')
  
  // Then try to advance station READY -> PLAYING
  await callEndpoint('/api/station/advance', 'Station')
}

// Initial run
runCronCycle()

// Set up interval
const interval = setInterval(() => {
  if (running) {
    runCronCycle()
  }
}, INTERVAL_MS)

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down cron simulator...')
  running = false
  clearInterval(interval)
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down cron simulator...')
  running = false  
  clearInterval(interval)
  process.exit(0)
})