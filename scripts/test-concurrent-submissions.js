#!/usr/bin/env node

/**
 * Concurrent Submission Testing Script for Sprint 7
 * 
 * This script simulates multiple users submitting tracks concurrently
 * to test the system under light concurrent load.
 */

const crypto = require('crypto')

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'
const CONCURRENT_USERS = parseInt(process.env.CONCURRENT_USERS || '5')
const SUBMISSIONS_PER_USER = parseInt(process.env.SUBMISSIONS_PER_USER || '2')
const DELAY_BETWEEN_SUBMISSIONS = parseInt(process.env.DELAY_MS || '1000')

// Test prompts
const TEST_PROMPTS = [
  "upbeat electronic dance music",
  "chill ambient background music",
  "rock guitar solo with drums",
  "jazz piano with soft trumpet",
  "orchestral movie soundtrack",
  "reggae with steel drums",
  "folk acoustic guitar",
  "hip hop beat with bass",
  "classical violin piece",
  "synthwave retro vibes"
]

// Generate random user ID
function generateUserId() {
  return crypto.randomUUID()
}

// Get random prompt
function getRandomPrompt() {
  return TEST_PROMPTS[Math.floor(Math.random() * TEST_PROMPTS.length)]
}

// Submit a track
async function submitTrack(userId, prompt, duration = 60) {
  const response = await fetch(`${BASE_URL}/api/queue/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user_id: userId,
      prompt: prompt,
      duration_seconds: duration
    })
  })

  const data = await response.json()
  
  return {
    status: response.status,
    data,
    prompt: prompt.substring(0, 30) + '...',
    userId: userId.substring(0, 8)
  }
}

// Get price quote
async function getPriceQuote(duration = 60) {
  const response = await fetch(`${BASE_URL}/api/queue/price-quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      duration_seconds: duration
    })
  })

  return response.json()
}

// Check station state
async function getStationState() {
  const response = await fetch(`${BASE_URL}/api/station/state`)
  return response.json()
}

// Test health endpoint
async function checkHealth() {
  const response = await fetch(`${BASE_URL}/api/health`)
  const data = await response.json()
  
  console.log(`🏥 Health Status: ${data.status.toUpperCase()}`)
  console.log(`   - Database: ${data.services.database.status}`)
  console.log(`   - ElevenLabs: ${data.services.eleven_labs.status}`)
  console.log(`   - Storage: ${data.services.storage.status}`)
  console.log(`   - Total Tracks: ${data.system.queue_stats.total_tracks}`)
  console.log(`   - Feature Flags: X402=${data.system.feature_flags.ENABLE_X402}, ElevenLabs=${data.system.feature_flags.ENABLE_REAL_ELEVEN}`)
  console.log('')
  
  return data
}

// Simulate user behavior
async function simulateUser(userId, userIndex) {
  console.log(`👤 User ${userIndex + 1} (${userId.substring(0, 8)}) starting...`)
  
  const results = []
  
  for (let i = 0; i < SUBMISSIONS_PER_USER; i++) {
    try {
      const prompt = getRandomPrompt()
      console.log(`   📝 Submitting: "${prompt.substring(0, 30)}..."`)
      
      const result = await submitTrack(userId, prompt, 60)
      results.push(result)
      
      if (result.status === 201) {
        console.log(`   ✅ Success: Track created (${result.data.track?.id})`)
      } else if (result.status === 402) {
        console.log(`   💰 Payment required: Track ${result.data.track_id}`)
      } else if (result.status === 429) {
        console.log(`   ⏰ Rate limited: ${result.data.error}`)
      } else {
        console.log(`   ❌ Failed: ${result.status} - ${result.data.error}`)
      }
      
      // Wait between submissions
      if (i < SUBMISSIONS_PER_USER - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_SUBMISSIONS))
      }
      
    } catch (error) {
      console.log(`   💥 Error: ${error.message}`)
      results.push({ error: error.message, prompt: 'unknown', userId })
    }
  }
  
  console.log(`👤 User ${userIndex + 1} completed ${results.length} submissions`)
  return results
}

// Main test function
async function runConcurrentTest() {
  console.log('🚀 Starting Concurrent Submission Test')
  console.log(`   - Base URL: ${BASE_URL}`)
  console.log(`   - Concurrent Users: ${CONCURRENT_USERS}`)
  console.log(`   - Submissions per User: ${SUBMISSIONS_PER_USER}`)
  console.log(`   - Delay between submissions: ${DELAY_BETWEEN_SUBMISSIONS}ms`)
  console.log('')
  
  // Check initial health
  console.log('📋 Pre-test Health Check:')
  const initialHealth = await checkHealth()
  
  // Get initial price quote
  console.log('💰 Price Quote Check:')
  try {
    const quote = await getPriceQuote(60)
    console.log(`   - 60s track: $${quote.price_usd}`)
  } catch (error) {
    console.log(`   - Price quote failed: ${error.message}`)
  }
  console.log('')
  
  // Generate users
  const users = Array.from({ length: CONCURRENT_USERS }, () => generateUserId())
  
  console.log('🏁 Starting concurrent submissions...')
  const startTime = Date.now()
  
  // Run concurrent user simulations
  const allResults = await Promise.all(
    users.map((userId, index) => simulateUser(userId, index))
  )
  
  const endTime = Date.now()
  const totalTime = endTime - startTime
  
  console.log('')
  console.log('📊 Test Results Summary:')
  console.log(`   - Total time: ${totalTime}ms`)
  console.log(`   - Total submissions: ${allResults.flat().length}`)
  
  // Analyze results
  const allSubmissions = allResults.flat()
  const successful = allSubmissions.filter(r => r.status === 201).length
  const paymentRequired = allSubmissions.filter(r => r.status === 402).length
  const rateLimited = allSubmissions.filter(r => r.status === 429).length
  const errors = allSubmissions.filter(r => r.error || (r.status && r.status >= 400 && r.status !== 402 && r.status !== 429)).length
  
  console.log(`   - Successful (201): ${successful}`)
  console.log(`   - Payment Required (402): ${paymentRequired}`)
  console.log(`   - Rate Limited (429): ${rateLimited}`)
  console.log(`   - Errors (4xx/5xx): ${errors}`)
  console.log('')
  
  // Check post-test health
  console.log('📋 Post-test Health Check:')
  const finalHealth = await checkHealth()
  
  // Check station state
  console.log('🎵 Final Station State:')
  try {
    const stationState = await getStationState()
    console.log(`   - Current track: ${stationState.station_state.current_track?.prompt || 'None'}`)
    console.log(`   - Queue length: ${stationState.queue.length}`)
    console.log(`   - Playhead: ${Math.floor(stationState.playhead_seconds)}s`)
  } catch (error) {
    console.log(`   - Failed to get station state: ${error.message}`)
  }
  
  console.log('')
  console.log('✅ Concurrent test completed!')
  
  // Return summary for analysis
  return {
    duration_ms: totalTime,
    total_submissions: allSubmissions.length,
    results: {
      successful,
      paymentRequired,
      rateLimited,
      errors
    },
    health: {
      initial: initialHealth.status,
      final: finalHealth.status
    }
  }
}

// Run the test if called directly
if (require.main === module) {
  runConcurrentTest()
    .then(summary => {
      console.log('')
      console.log('🎯 Test Summary:', JSON.stringify(summary, null, 2))
      process.exit(0)
    })
    .catch(error => {
      console.error('💥 Test failed:', error)
      process.exit(1)
    })
}

module.exports = { runConcurrentTest }