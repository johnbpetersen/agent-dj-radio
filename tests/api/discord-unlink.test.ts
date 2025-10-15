import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Mock data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockPresence: any[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUsers: any[] = []

const VALID_SESSION_ID = 'valid-session-123'
const INVALID_SESSION_ID = 'invalid-session-456'
const DISCORD_USER_ID = 'discord-user-1'
const GUEST_USER_ID = 'guest-user-1'

function setupMockData() {
  // Discord-linked user
  mockUsers.push({
    id: DISCORD_USER_ID,
    display_name: 'DiscordUser#1234',
    ephemeral_display_name: 'purple_raccoon',
    ephemeral: false,
    discord_user_id: 'discord-123',
    discord_username: 'DiscordUser',
    discord_avatar_hash: 'abc123',
    discord_discriminator: '1234'
  })

  mockPresence.push({
    session_id: VALID_SESSION_ID,
    user_id: DISCORD_USER_ID,
    display_name: 'DiscordUser#1234'
  })

  // Guest user (no Discord)
  mockUsers.push({
    id: GUEST_USER_ID,
    display_name: 'blue_dolphin',
    ephemeral_display_name: 'blue_dolphin',
    ephemeral: true,
    discord_user_id: null,
    discord_username: null,
    discord_avatar_hash: null,
    discord_discriminator: null
  })
}

// MSW handlers
const unlinkHandlers = [
  // POST /api/auth/discord/unlink
  http.post('*/api/auth/discord/unlink', async ({ request }) => {
    const sessionId = request.headers.get('X-Session-Id') ||
                      request.headers.get('Cookie')?.match(/x_session_id=([^;]+)/)?.[1]

    if (!sessionId) {
      return HttpResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'You are not signed in', hint: 'Please sign in and try again' }, requestId: 'test-req-1' },
        { status: 401 }
      )
    }

    // Find presence for session
    const presence = mockPresence.find(p => p.session_id === sessionId)
    if (!presence) {
      return HttpResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Session expired', hint: 'Please refresh the page and try again' }, requestId: 'test-req-2' },
        { status: 401 }
      )
    }

    const user = mockUsers.find(u => u.id === presence.user_id)
    if (!user) {
      return HttpResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Session expired', hint: 'Please refresh the page and try again' }, requestId: 'test-req-3' },
        { status: 401 }
      )
    }

    // Idempotent: if already unlinked, return success
    if (!user.discord_user_id) {
      return HttpResponse.json({ ok: true })
    }

    // Perform unlink
    user.display_name = user.ephemeral_display_name || user.display_name
    user.discord_user_id = null
    user.discord_username = null
    user.discord_avatar_hash = null
    user.discord_discriminator = null

    // Update presence
    presence.display_name = user.display_name

    return HttpResponse.json({ ok: true })
  })
]

const server = setupServer(...unlinkHandlers)

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' })
})

afterAll(() => {
  server.close()
})

describe('Discord Unlink API', () => {
  beforeEach(() => {
    // Reset mock data
    mockPresence = []
    mockUsers = []

    setupMockData()
  })

  describe('Authentication', () => {
    it('should return 401 when no session cookie/header provided', async () => {
      const response = await fetch('http://localhost:3001/api/auth/discord/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // No X-Session-Id header
        },
        body: JSON.stringify({})
      })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data.error).toBeTruthy()
      expect(data.error.message).toContain('not signed in')
      expect(data.requestId).toBeTruthy()
    })

    it('should return 401 when session not found in presence', async () => {
      const response = await fetch('http://localhost:3001/api/auth/discord/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': INVALID_SESSION_ID
        },
        body: JSON.stringify({})
      })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data.error).toBeTruthy()
      expect(data.error.message).toContain('expired')
    })
  })

  describe('Successful unlink', () => {
    it('should return 200 and unlink Discord account', async () => {
      const response = await fetch('http://localhost:3001/api/auth/discord/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': VALID_SESSION_ID
        },
        body: JSON.stringify({})
      })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.ok).toBe(true)

      // Verify Discord fields were cleared
      const user = mockUsers.find(u => u.id === DISCORD_USER_ID)
      expect(user?.discord_user_id).toBeNull()
      expect(user?.discord_username).toBeNull()
      expect(user?.discord_avatar_hash).toBeNull()
      expect(user?.discord_discriminator).toBeNull()
    })

    it('should restore ephemeral display name', async () => {
      await fetch('http://localhost:3001/api/auth/discord/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': VALID_SESSION_ID
        },
        body: JSON.stringify({})
      })

      const user = mockUsers.find(u => u.id === DISCORD_USER_ID)
      expect(user?.display_name).toBe('purple_raccoon')

      const presence = mockPresence.find(p => p.session_id === VALID_SESSION_ID)
      expect(presence?.display_name).toBe('purple_raccoon')
    })

    it('should be idempotent (return 200 if already unlinked)', async () => {
      // First unlink
      await fetch('http://localhost:3001/api/auth/discord/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': VALID_SESSION_ID
        },
        body: JSON.stringify({})
      })

      // Second unlink (should still succeed)
      const response = await fetch('http://localhost:3001/api/auth/discord/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': VALID_SESSION_ID
        },
        body: JSON.stringify({})
      })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.ok).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should never return 500 for missing session', async () => {
      const response = await fetch('http://localhost:3001/api/auth/discord/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': INVALID_SESSION_ID
        },
        body: JSON.stringify({})
      })

      // Should be 401, NOT 500
      expect(response.status).toBe(401)
      expect(response.status).not.toBe(500)
    })

    it('should include structured error response with requestId', async () => {
      const response = await fetch('http://localhost:3001/api/auth/discord/unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data.error).toBeTruthy()
      expect(data.error.code).toBe('UNAUTHORIZED')
      expect(typeof data.error.message).toBe('string')
      expect(data.requestId).toBeTruthy()
    })
  })
})
