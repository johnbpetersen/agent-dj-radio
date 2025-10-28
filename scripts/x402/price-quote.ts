#!/usr/bin/env tsx
// scripts/x402/price-quote.ts
// Test price quote endpoint
// Usage: npm run x402:price-quote [base_url]

const BASE_URL = process.argv[2] || process.env.BASE_URL || 'http://localhost:3000'
const QUOTE_ENDPOINT = '/api/queue/price-quote'

console.log('💰 Testing x402 price quote endpoint...')
console.log(`Base URL: ${BASE_URL}`)
console.log(`Endpoint: ${QUOTE_ENDPOINT}`)
console.log('')

const durations = [60, 90, 120]

async function testQuote(duration: number) {
  const url = `${BASE_URL}${QUOTE_ENDPOINT}`

  try {
    console.log(`[${duration}s] Requesting quote...`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ duration_seconds: duration })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ HTTP ${response.status}: ${errorText}`)
      return false
    }

    const data = await response.json()

    if (data.price_usd && data.duration_seconds === duration) {
      console.log(`✅ ${duration}s → $${data.price_usd.toFixed(2)} USD`)
      return true
    } else {
      console.error(`❌ Invalid response format:`, JSON.stringify(data, null, 2))
      return false
    }

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error(`❌ Connection refused. Is the server running at ${BASE_URL}?`)
    } else if (error.code === 'ENOTFOUND') {
      console.error(`❌ DNS lookup failed for ${BASE_URL}`)
    } else {
      console.error(`❌ Error: ${error.message}`)
    }
    return false
  }
}

async function main() {
  let allPassed = true

  for (const duration of durations) {
    const passed = await testQuote(duration)
    if (!passed) allPassed = false
    console.log('')
  }

  // Test invalid duration
  console.log('[Invalid] Testing invalid duration (45s)...')
  try {
    const response = await fetch(`${BASE_URL}${QUOTE_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_seconds: 45 })
    })

    if (response.status === 400) {
      const data = await response.json()
      console.log(`✅ Correctly rejected: ${data.error}`)
    } else {
      console.error(`❌ Expected 400, got ${response.status}`)
      allPassed = false
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`)
    allPassed = false
  }

  console.log('')
  console.log('─'.repeat(50))

  if (allPassed) {
    console.log('✅ All price quote tests passed!')
    process.exit(0)
  } else {
    console.log('❌ Some tests failed')
    process.exit(1)
  }
}

main()
