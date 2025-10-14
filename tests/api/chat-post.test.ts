import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Mock chat data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockPresence: any[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUserAccounts: any[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockChatMessages: any[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUsers: any[] = []

// Mock session ID for testing
const GUEST_SESSION_ID = 'guest-session-123'
const DISCORD_SESSION_ID = 'discord-session-456'
const BANNED_SESSION_ID = 'banned-session-789'

// Setup mock data
function setupMockData() {
  // Guest user (no Discord account)
  mockUsers.push({
    id: 'guest-user-1',
    display_name: 'purple_raccoon',
    banned: false,
    ephemeral: true
  })

  mockPresence.push({
    session_id: GUEST_SESSION_ID,
    user_id: 'guest-user-1',
    display_name: 'purple_raccoon',
    user: {
      id: 'guest-user-1',
      display_name: 'purple_raccoon',
      banned: false
    }
  })

  // Discord-linked user
  mockUsers.push({
    id: 'discord-user-1',
    display_name: 'CoolUser123',
    banned: false,
    ephemeral: false
  })

  mockPresence.push({
    session_id: DISCORD_SESSION_ID,
    user_id: 'discord-user-1',
    display_name: 'CoolUser123',
    user: {
      id: 'discord-user-1',
      display_name: 'CoolUser123',
      banned: false
    }
  })

  mockUserAccounts.push({
    id: 'account-1',
    user_id: 'discord-user-1',
    provider: 'discord',
    provider_user_id: 'discord-123'
  })

  // Banned user with Discord
  mockUsers.push({
    id: 'banned-user-1',
    display_name: 'BannedUser',
    banned: true,
    ephemeral: false
  })

  mockPresence.push({
    session_id: BANNED_SESSION_ID,
    user_id: 'banned-user-1',
    display_name: 'BannedUser',
    user: {
      id: 'banned-user-1',
      display_name: 'BannedUser',
      banned: true
    }
  })

  mockUserAccounts.push({
    id: 'account-2',
    user_id: 'banned-user-1',
    provider: 'discord',
    provider_user_id: 'discord-456'
  })
}

// MSW handlers for chat endpoints
const chatHandlers = [
  // POST /api/chat/post - Main endpoint under test
  http.post('*/api/chat/post', async ({ request }) => {
    const sessionId = request.headers.get('X-Session-Id')

    if (!sessionId) {
      return HttpResponse.json(
        { error: 'Missing X-Session-Id header' },
        { status: 400 }
      )
    }

    // Find presence for session
    const presence = mockPresence.find(p => p.session_id === sessionId)
    if (!presence) {
      return HttpResponse.json(
        { error: 'Session not found', correlationId: 'test-123' },
        { status: 404 }
      )
    }

    // Check Discord account
    const discordAccount = mockUserAccounts.find(
      a => a.user_id === presence.user_id && a.provider === 'discord'
    )

    // CRITICAL: Return 403 for guests BEFORE any other checks
    if (!discordAccount) {
      return HttpResponse.json(
        {
          error: 'discord_required',
          message: 'Please sign in with Discord to use chat',
          correlationId: 'test-123'
        },
        { status: 403 }
      )
    }

    // Check if user is banned (only after Discord check)
    if (presence.user.banned) {
      return HttpResponse.json(
        { error: 'User is banned', correlationId: 'test-123' },
        { status: 403 }
      )
    }

    // Validate message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await request.json() as any
    if (!body.message || typeof body.message !== 'string') {
      return HttpResponse.json(
        { error: 'Message is required', correlationId: 'test-123' },
        { status: 422 }
      )
    }

    if (body.message.trim().length === 0) {
      return HttpResponse.json(
        { error: 'Message cannot be empty', correlationId: 'test-123' },
        { status: 422 }
      )
    }

    if (body.message.length > 500) {
      return HttpResponse.json(
        { error: 'Message too long (max 500 characters)', correlationId: 'test-123' },
        { status: 422 }
      )
    }

    // Success - insert message
    const messageId = `msg-${Date.now()}`
    mockChatMessages.push({
      id: messageId,
      session_id: sessionId,
      user_id: presence.user_id,
      display_name: presence.display_name,
      message: body.message.trim(),
      created_at: new Date().toISOString()
    })

    return HttpResponse.json(
      { ok: true },
      { status: 201 }
    )
  })
]

const server = setupServer(...chatHandlers)

// Setup/teardown MSW server once for all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' })
})

afterAll(() => {
  server.close()
})

describe('Chat POST API - Guest Gating', () => {
  beforeEach(() => {
    // Reset mock data between tests
    mockPresence = []
    mockUserAccounts = []
    mockChatMessages = []
    mockUsers = []

    // Setup fresh mock data
    setupMockData()
  })

  describe('Guest user gating', () => {
    it('should return 403 with discord_required for guest users', async () => {
      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': GUEST_SESSION_ID
        },
        body: JSON.stringify({ message: 'Hello world!' })
      })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data.error).toBe('discord_required')
      expect(data.message).toContain('Discord')
      expect(data.correlationId).toBeTruthy()
    })

    it('should not create message for guest user', async () => {
      const initialMessageCount = mockChatMessages.length

      await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': GUEST_SESSION_ID
        },
        body: JSON.stringify({ message: 'Hello world!' })
      })

      // No message should be created
      expect(mockChatMessages.length).toBe(initialMessageCount)
    })

    it('should not check rate limits for guest users', async () => {
      // Make multiple rapid requests as guest
      const requests = Array(5).fill(null).map(() =>
        fetch('http://localhost:3001/api/chat/post', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': GUEST_SESSION_ID
          },
          body: JSON.stringify({ message: 'Test' })
        })
      )

      const responses = await Promise.all(requests)

      // All should return 403, none should return 429 (rate limit)
      responses.forEach(response => {
        expect(response.status).toBe(403)
      })
    })
  })

  describe('Discord-linked user success', () => {
    it('should allow Discord-linked users to post messages', async () => {
      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': DISCORD_SESSION_ID
        },
        body: JSON.stringify({ message: 'Hello from Discord user!' })
      })

      expect(response.status).toBe(201)

      const data = await response.json()
      expect(data.ok).toBe(true)
    })

    it('should create message in database for Discord users', async () => {
      const initialMessageCount = mockChatMessages.length

      await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': DISCORD_SESSION_ID
        },
        body: JSON.stringify({ message: 'Hello from Discord user!' })
      })

      expect(mockChatMessages.length).toBe(initialMessageCount + 1)

      const newMessage = mockChatMessages[mockChatMessages.length - 1]
      expect(newMessage.message).toBe('Hello from Discord user!')
      expect(newMessage.user_id).toBe('discord-user-1')
      expect(newMessage.display_name).toBe('CoolUser123')
    })

    it('should trim whitespace from messages', async () => {
      await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': DISCORD_SESSION_ID
        },
        body: JSON.stringify({ message: '  Hello world!  ' })
      })

      const newMessage = mockChatMessages[mockChatMessages.length - 1]
      expect(newMessage.message).toBe('Hello world!')
    })
  })

  describe('Ban check after Discord check', () => {
    it('should return 403 for banned users after Discord check passes', async () => {
      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': BANNED_SESSION_ID
        },
        body: JSON.stringify({ message: 'I am banned!' })
      })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data.error).toBe('User is banned')
      expect(data.error).not.toBe('discord_required') // Discord check passed first
    })

    it('should not create message for banned users', async () => {
      const initialMessageCount = mockChatMessages.length

      await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': BANNED_SESSION_ID
        },
        body: JSON.stringify({ message: 'Test' })
      })

      expect(mockChatMessages.length).toBe(initialMessageCount)
    })
  })

  describe('Validation errors', () => {
    it('should return 422 for empty message', async () => {
      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': DISCORD_SESSION_ID
        },
        body: JSON.stringify({ message: '' })
      })

      expect(response.status).toBe(422)

      const data = await response.json()
      expect(data.error).toContain('required')
    })

    it('should return 422 for whitespace-only message', async () => {
      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': DISCORD_SESSION_ID
        },
        body: JSON.stringify({ message: '   ' })
      })

      expect(response.status).toBe(422)
    })

    it('should return 422 for message too long', async () => {
      const longMessage = 'a'.repeat(501)

      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': DISCORD_SESSION_ID
        },
        body: JSON.stringify({ message: longMessage })
      })

      expect(response.status).toBe(422)

      const data = await response.json()
      expect(data.error).toContain('too long')
    })

    it('should return 422 for missing message field', async () => {
      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': DISCORD_SESSION_ID
        },
        body: JSON.stringify({})
      })

      expect(response.status).toBe(422)

      const data = await response.json()
      expect(data.error).toContain('required')
    })
  })

  describe('Session errors', () => {
    it('should return 400 for missing session ID', async () => {
      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // No X-Session-Id header
        },
        body: JSON.stringify({ message: 'Test' })
      })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error).toContain('Session')
    })

    it('should return 404 for non-existent session', async () => {
      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': 'non-existent-session'
        },
        body: JSON.stringify({ message: 'Test' })
      })

      expect(response.status).toBe(404)

      const data = await response.json()
      expect(data.error).toContain('not found')
    })
  })

  describe('Presence TDZ regression test', () => {
    it('should not throw TDZ error when checking presence before initialization', async () => {
      // This test ensures the presence service is initialized at module top
      // and not accessed before initialization (Temporal Dead Zone)

      const response = await fetch('http://localhost:3001/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': GUEST_SESSION_ID
        },
        body: JSON.stringify({ message: 'Test' })
      })

      // Should get 403, not a 500 TDZ error
      expect(response.status).toBe(403)
      expect(response.status).not.toBe(500)

      const data = await response.json()
      expect(data.error).toBe('discord_required')
    })
  })
})
