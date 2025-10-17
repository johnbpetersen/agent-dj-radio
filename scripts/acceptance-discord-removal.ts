#!/usr/bin/env tsx
// scripts/acceptance-discord-removal.ts
// Acceptance tests for Discord removal - verifies tombstones and clean payloads

import { inspect } from 'node:util'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001'

interface TestResult {
  name: string
  passed: boolean
  message: string
}

const results: TestResult[] = []

function pass(name: string, message: string) {
  results.push({ name, passed: true, message })
  console.log(`✅ PASS: ${name}`)
}

function fail(name: string, message: string) {
  results.push({ name, passed: false, message })
  console.error(`❌ FAIL: ${name} - ${message}`)
}

async function testDiscordStartTombstone() {
  try {
    const response = await fetch(`${BASE_URL}/api/auth/discord/start`, {
      method: 'GET',
      redirect: 'manual'
    })

    // Check status is 410 Gone
    if (response.status !== 410) {
      fail('Discord start tombstone (status)', `Expected 410, got ${response.status}`)
      return
    }

    // Check response body contains GONE error
    const body = await response.json()
    if (body.error?.code !== 'GONE') {
      fail('Discord start tombstone (error code)', `Expected error.code='GONE', got ${body.error?.code}`)
      return
    }

    // Check Set-Cookie header clears oauth_state
    const setCookie = response.headers.get('set-cookie')
    if (!setCookie) {
      fail('Discord start tombstone (cookie)', 'No Set-Cookie header found')
      return
    }

    if (!setCookie.includes('oauth_state=') || !setCookie.includes('Max-Age=0')) {
      fail('Discord start tombstone (cookie)', `Cookie doesn't clear oauth_state: ${setCookie}`)
      return
    }

    pass('Discord start tombstone', '410 Gone + oauth_state cleared')
  } catch (error) {
    fail('Discord start tombstone', `Network error: ${error}`)
  }
}

async function testDiscordCallbackTombstone() {
  try {
    const response = await fetch(`${BASE_URL}/api/auth/discord/callback?code=test&state=test`, {
      method: 'GET',
      redirect: 'manual'
    })

    // Check status is 410 Gone
    if (response.status !== 410) {
      fail('Discord callback tombstone (status)', `Expected 410, got ${response.status}`)
      return
    }

    // Check response body contains GONE error
    const body = await response.json()
    if (body.error?.code !== 'GONE') {
      fail('Discord callback tombstone (error code)', `Expected error.code='GONE', got ${body.error?.code}`)
      return
    }

    // Check Set-Cookie header clears oauth_state
    const setCookie = response.headers.get('set-cookie')
    if (!setCookie) {
      fail('Discord callback tombstone (cookie)', 'No Set-Cookie header found')
      return
    }

    if (!setCookie.includes('oauth_state=') || !setCookie.includes('Max-Age=0')) {
      fail('Discord callback tombstone (cookie)', `Cookie doesn't clear oauth_state: ${setCookie}`)
      return
    }

    pass('Discord callback tombstone', '410 Gone + oauth_state cleared')
  } catch (error) {
    fail('Discord callback tombstone', `Network error: ${error}`)
  }
}

async function testSessionHelloPayload() {
  try {
    const response = await fetch(`${BASE_URL}/api/session/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'test_user' })
    })

    if (!response.ok) {
      fail('Session hello payload', `Non-200 response: ${response.status}`)
      return
    }

    const body = await response.json()
    const bodyStr = JSON.stringify(body)

    // Check for Discord-related fields that should NOT exist
    const forbiddenFields = ['isDiscordLinked', 'discord', 'discordUsername', 'discord_user_id']
    const foundForbidden = forbiddenFields.filter(field =>
      bodyStr.toLowerCase().includes(field.toLowerCase())
    )

    if (foundForbidden.length > 0) {
      fail('Session hello payload', `Found forbidden fields: ${foundForbidden.join(', ')}`)
      return
    }

    // Verify expected structure
    if (!body.user || !body.identity || !body.session_id) {
      fail('Session hello payload', `Missing expected fields: ${inspect(body)}`)
      return
    }

    pass('Session hello payload', 'No Discord references in response')
  } catch (error) {
    fail('Session hello payload', `Network error: ${error}`)
  }
}

async function testChatPresenceAuth() {
  try {
    // First, create a session
    const helloResponse = await fetch(`${BASE_URL}/api/session/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'chat_test_user' })
    })

    if (!helloResponse.ok) {
      fail('Chat presence auth', `Failed to create session: ${helloResponse.status}`)
      return
    }

    const helloBody = await helloResponse.json()
    const sessionId = helloBody.session_id
    const setCookie = helloResponse.headers.get('set-cookie')

    if (!sessionId || !setCookie) {
      fail('Chat presence auth', 'Session creation missing sid or cookie')
      return
    }

    // Extract sid cookie value
    const sidMatch = setCookie.match(/sid=([^;]+)/)
    if (!sidMatch) {
      fail('Chat presence auth', 'Could not extract sid from cookie')
      return
    }

    // Try to post a chat message with session
    const chatResponse = await fetch(`${BASE_URL}/api/chat/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `sid=${sidMatch[1]}`
      },
      body: JSON.stringify({ message: 'Test message' })
    })

    // Check if chat feature is enabled (404 = feature disabled, that's ok)
    if (chatResponse.status === 404) {
      pass('Chat presence auth', 'Chat feature disabled (404) - skipped')
      return
    }

    // If chat is enabled, it should work with just presence (no Discord requirement)
    // 201 = success, 429 = rate limited (also valid), 403 = forbidden (BAD - means Discord still required)
    if (chatResponse.status === 403) {
      const errorBody = await chatResponse.json()
      if (errorBody.error === 'discord_required' || errorBody.message?.includes('Discord')) {
        fail('Chat presence auth', 'Chat still requires Discord (403 with Discord error)')
        return
      }
    }

    if (chatResponse.status === 201 || chatResponse.status === 429) {
      pass('Chat presence auth', `Chat accessible with presence only (${chatResponse.status})`)
    } else {
      fail('Chat presence auth', `Unexpected status: ${chatResponse.status}`)
    }
  } catch (error) {
    fail('Chat presence auth', `Network error: ${error}`)
  }
}

async function runTests() {
  console.log('🧪 Discord Removal Acceptance Tests')
  console.log(`Testing against: ${BASE_URL}`)
  console.log('=' .repeat(60))

  await testDiscordStartTombstone()
  await testDiscordCallbackTombstone()
  await testSessionHelloPayload()
  await testChatPresenceAuth()

  console.log('=' .repeat(60))
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed (total: ${results.length})`)

  if (failed > 0) {
    console.error('\n❌ ACCEPTANCE TESTS FAILED')
    process.exit(1)
  } else {
    console.log('\n✅ ALL ACCEPTANCE TESTS PASSED')
    process.exit(0)
  }
}

runTests()
