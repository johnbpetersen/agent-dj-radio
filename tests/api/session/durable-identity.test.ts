// tests/api/session/durable-identity.test.ts
// Comprehensive tests for durable session-based identity
// Tests that identity persists across presence expiry via sessions table

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ensureSession, getSessionId, setSessionCookie, parseCookies } from '../../../api/_shared/session-helpers.js'
import { supabaseAdmin } from '../../../api/_shared/supabase.js'

// Mock supabaseAdmin
vi.mock('../../../api/_shared/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn()
  }
}))

// Mock logger to prevent console noise
vi.mock('../../../src/lib/logger.js', () => ({
  generateCorrelationId: vi.fn(() => 'mock-uuid-' + Date.now()),
  logger: {
    request: vi.fn(),
    requestComplete: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Helper to create mock request
function createMockRequest(cookies?: Record<string, string>, headers?: Record<string, string>): VercelRequest {
  const cookieString = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    : undefined

  return {
    headers: {
      'x-forwarded-proto': 'https',
      cookie: cookieString,
      ...headers
    },
    method: 'POST',
    body: {},
    query: {},
    url: '/api/session/hello'
  } as any
}

// Helper to create mock response with header tracking
function createMockResponse(): VercelResponse & { _headers: Map<string, string | string[]> } {
  const headers = new Map<string, string | string[]>()

  return {
    _headers: headers,
    setHeader: vi.fn((name: string, value: string | string[]) => {
      headers.set(name, value)
    }),
    getHeader: vi.fn((name: string) => headers.get(name)),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis()
  } as any
}

// Helper to parse Set-Cookie header attributes
function parseCookieAttributes(setCookieHeader: string): Record<string, string | boolean> {
  const parts = setCookieHeader.split(';').map(p => p.trim())
  const attrs: Record<string, string | boolean> = {}

  // First part is sid=value
  const [name, value] = parts[0].split('=')
  attrs.name = name
  attrs.value = value

  // Remaining parts are attributes
  for (let i = 1; i < parts.length; i++) {
    const [key, val] = parts[i].split('=')
    if (val) {
      attrs[key] = val
    } else {
      attrs[key] = true  // Flag attributes like HttpOnly, Secure
    }
  }

  return attrs
}

describe('Durable Session Identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSessionId', () => {
    it('should prioritize X-Session-Id header over cookie', () => {
      const req = createMockRequest({ sid: 'cookie-id' }, { 'x-session-id': 'header-id' })
      const result = getSessionId(req)
      expect(result).toBe('header-id')
    })

    it('should fallback to cookie if no header', () => {
      const req = createMockRequest({ sid: 'cookie-id' })
      const result = getSessionId(req)
      expect(result).toBe('cookie-id')
    })

    it('should return null if neither exists', () => {
      const req = createMockRequest()
      const result = getSessionId(req)
      expect(result).toBeNull()
    })
  })

  describe('setSessionCookie', () => {
    it('should set cookie with correct attributes over HTTPS', () => {
      const req = createMockRequest(undefined, { 'x-forwarded-proto': 'https' })
      const res = createMockResponse()

      setSessionCookie(res, 'test-session-id', req)

      expect(res.setHeader).toHaveBeenCalled()
      const setCookieHeader = res._headers.get('Set-Cookie') as string
      expect(setCookieHeader).toBeDefined()

      const attrs = parseCookieAttributes(setCookieHeader)
      expect(attrs.name).toBe('sid')
      expect(attrs.value).toBe('test-session-id')
      expect(attrs.HttpOnly).toBe(true)
      expect(attrs.SameSite).toBe('Lax')
      expect(attrs.Secure).toBe(true)
      expect(attrs.Path).toBe('/')
      expect(attrs['Max-Age']).toBe('2592000') // 30 days
    })

    it('should omit Secure attribute over HTTP', () => {
      const req = createMockRequest(undefined, { 'x-forwarded-proto': 'http' })
      const res = createMockResponse()

      setSessionCookie(res, 'test-session-id', req)

      const setCookieHeader = res._headers.get('Set-Cookie') as string
      const attrs = parseCookieAttributes(setCookieHeader)
      expect(attrs.Secure).toBeUndefined()
    })
  })

  describe('parseCookies', () => {
    it('should parse multiple cookies', () => {
      const req = createMockRequest({ sid: 'session-123', other: 'value' })
      const cookies = parseCookies(req)
      expect(cookies.sid).toBe('session-123')
      expect(cookies.other).toBe('value')
    })

    it('should handle missing cookie header', () => {
      const req = createMockRequest()
      const cookies = parseCookies(req)
      expect(cookies).toEqual({})
    })
  })

  describe('Scenario 1: First visit (no cookie) → new user + session + cookie', () => {
    it('should create new guest user, session row, presence, and set cookie', async () => {
      const req = createMockRequest() // No cookie
      const res = createMockResponse()

      const mockUserId = 'user-new-123'
      const mockDisplayName = 'happy_raccoon'
      const mockSessionId = 'session-new-456'

      // Mock generateCorrelationId to return predictable sessionId
      vi.mocked(await import('../../../src/lib/logger.js')).generateCorrelationId
        .mockReturnValueOnce(mockUserId)
        .mockReturnValueOnce(mockSessionId)

      // Mock user creation (createGuestUserWithUniqueName succeeds)
      const mockFromUsers = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: mockUserId, display_name: mockDisplayName },
              error: null
            })
          })
        })
      }

      // Mock session insert (succeeds)
      const mockFromSessions = {
        insert: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      }

      // Mock presence upsert
      const mockFromPresence = {
        upsert: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      }

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(mockFromUsers as any)    // users insert
        .mockReturnValueOnce(mockFromSessions as any)  // sessions insert
        .mockReturnValueOnce(mockFromPresence as any)  // presence upsert

      const result = await ensureSession(req, res)

      // Assertions: new user created
      expect(result.userId).toBe(mockUserId)
      expect(result.sessionId).toBe(mockSessionId)
      expect(result.shouldSetCookie).toBe(true)

      // Verify DB calls
      expect(supabaseAdmin.from).toHaveBeenCalledWith('users')
      expect(mockFromUsers.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockUserId,
          display_name: expect.any(String),
          ephemeral: true,
          banned: false
        })
      )

      expect(supabaseAdmin.from).toHaveBeenCalledWith('sessions')
      expect(mockFromSessions.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: mockSessionId,
          user_id: mockUserId
        })
      )

      expect(supabaseAdmin.from).toHaveBeenCalledWith('presence')
      expect(mockFromPresence.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: mockSessionId,
          user_id: mockUserId,
          display_name: mockDisplayName
        }),
        { onConflict: 'session_id' }
      )
    })
  })

  describe('Scenario 2: Same cookie after deleting presence → SAME user_id', () => {
    it('should reuse existing session mapping and recreate presence', async () => {
      const existingSessionId = 'session-existing-789'
      const existingUserId = 'user-existing-456'
      const existingDisplayName = 'cosmic_dolphin'

      const req = createMockRequest({ sid: existingSessionId })
      const res = createMockResponse()

      // Mock sessions table lookup (found!)
      const mockSessionsSelect = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { session_id: existingSessionId, user_id: existingUserId },
              error: null
            })
          })
        })
      }

      // Mock sessions update (last_seen_at)
      const mockSessionsUpdate = {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: null
          })
        })
      }

      // Mock user lookup for display_name
      const mockUsersSelect = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { display_name: existingDisplayName },
              error: null
            })
          })
        })
      }

      // Mock presence upsert (recreates after deletion)
      const mockPresenceUpsert = {
        upsert: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      }

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(mockSessionsSelect as any)  // sessions lookup
        .mockReturnValueOnce(mockSessionsUpdate as any)  // sessions update
        .mockReturnValueOnce(mockUsersSelect as any)     // users lookup
        .mockReturnValueOnce(mockPresenceUpsert as any)  // presence upsert

      const result = await ensureSession(req, res)

      // Assertions: SAME user_id returned
      expect(result.userId).toBe(existingUserId)
      expect(result.sessionId).toBe(existingSessionId)
      expect(result.shouldSetCookie).toBe(false) // Cookie already present

      // Verify sessions lookup
      expect(mockSessionsSelect.select).toHaveBeenCalledWith('session_id, user_id')

      // Verify last_seen_at updated
      expect(mockSessionsUpdate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          last_seen_at: expect.any(String)
        })
      )

      // Verify presence upserted (NOT queried for identity!)
      expect(mockPresenceUpsert.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: existingSessionId,
          user_id: existingUserId,
          display_name: existingDisplayName
        }),
        { onConflict: 'session_id' }
      )
    })
  })

  describe('Scenario 3: Cookie present but no session row → new guest user', () => {
    it('should create new guest user and new session mapping with warning', async () => {
      const orphanedSessionId = 'session-orphaned-999'

      const req = createMockRequest({ sid: orphanedSessionId })
      const res = createMockResponse()

      const mockNewUserId = 'user-recovery-123'
      const mockNewDisplayName = 'quantum_panda'

      // Mock logger to capture warning
      const { logger } = await import('../../../src/lib/logger.js')

      // Mock sessions lookup (NOT found - PGRST116 error)
      const mockSessionsSelect = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116', message: 'No rows found' }
            })
          })
        })
      }

      // Mock user creation
      const mockUsersInsert = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: mockNewUserId, display_name: mockNewDisplayName },
              error: null
            })
          })
        })
      }

      // Mock session insert (reuse orphaned sid)
      const mockSessionsInsert = {
        insert: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      }

      // Mock presence upsert
      const mockPresenceUpsert = {
        upsert: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      }

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(mockSessionsSelect as any)  // sessions lookup (miss)
        .mockReturnValueOnce(mockUsersInsert as any)     // users insert
        .mockReturnValueOnce(mockSessionsInsert as any)  // sessions insert
        .mockReturnValueOnce(mockPresenceUpsert as any)  // presence upsert

      // Spy on console.warn to verify warning
      const consoleWarnSpy = vi.spyOn(console, 'warn')

      const result = await ensureSession(req, res)

      // Assertions: new user created (identity cannot be recovered)
      expect(result.userId).toBe(mockNewUserId)
      expect(result.sessionId).toBe(orphanedSessionId) // Reuses orphaned sid
      expect(result.shouldSetCookie).toBe(true)

      // Verify warning logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[session-mapping-missing] Cookie present but no session row',
        expect.objectContaining({
          sidSuffix: orphanedSessionId.slice(-6)
        })
      )

      // Verify new session row created
      expect(mockSessionsInsert.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: orphanedSessionId,
          user_id: mockNewUserId
        })
      )

      consoleWarnSpy.mockRestore()
    })
  })

  describe('Edge Case: Invalid UUID in cookie → treat as missing', () => {
    it('should reject invalid UUID and create new session', async () => {
      const invalidSid = 'not-a-uuid'

      const req = createMockRequest({ sid: invalidSid })
      const res = createMockResponse()

      const mockNewUserId = 'user-new-456'
      const mockNewSessionId = 'session-new-789'

      vi.mocked(await import('../../../src/lib/logger.js')).generateCorrelationId
        .mockReturnValueOnce(mockNewUserId)
        .mockReturnValueOnce(mockNewSessionId)

      // Mock user creation
      const mockUsersInsert = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: mockNewUserId, display_name: 'stellar_falcon' },
              error: null
            })
          })
        })
      }

      const mockSessionsInsert = {
        insert: vi.fn().mockResolvedValue({ data: null, error: null })
      }

      const mockPresenceUpsert = {
        upsert: vi.fn().mockResolvedValue({ data: null, error: null })
      }

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(mockUsersInsert as any)
        .mockReturnValueOnce(mockSessionsInsert as any)
        .mockReturnValueOnce(mockPresenceUpsert as any)

      const result = await ensureSession(req, res)

      // Should NOT use invalid sid
      expect(result.sessionId).toBe(mockNewSessionId)
      expect(result.sessionId).not.toBe(invalidSid)

      // Should create new session
      expect(result.shouldSetCookie).toBe(true)
    })
  })

  describe('Edge Case: Concurrent requests race on session insert', () => {
    it('should handle PK conflict by reading winning row', async () => {
      const req = createMockRequest() // No cookie
      const res = createMockResponse()

      const mockSessionId = 'session-race-123'
      const mockWinnerUserId = 'user-winner-456'
      const mockWinnerDisplayName = 'lunar_phoenix'

      vi.mocked(await import('../../../src/lib/logger.js')).generateCorrelationId
        .mockReturnValueOnce('user-loser-999') // This user creation will be "lost"
        .mockReturnValueOnce(mockSessionId)

      // Mock user creation (succeeds for both requests)
      const mockUsersInsert = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'user-loser-999', display_name: 'dancing_octopus' },
              error: null
            })
          })
        })
      }

      // Mock session insert (FAILS with 23505 - duplicate key)
      const mockSessionsInsert = {
        insert: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '23505', message: 'duplicate key value' }
        })
      }

      // Mock retry read (finds winner's row)
      const mockSessionsSelect = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { user_id: mockWinnerUserId },
              error: null
            })
          })
        })
      }

      // Mock winner user lookup
      const mockWinnerUserSelect = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { display_name: mockWinnerDisplayName },
              error: null
            })
          })
        })
      }

      // Mock presence upsert
      const mockPresenceUpsert = {
        upsert: vi.fn().mockResolvedValue({ data: null, error: null })
      }

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(mockUsersInsert as any)      // loser user created
        .mockReturnValueOnce(mockSessionsInsert as any)   // session insert fails
        .mockReturnValueOnce(mockSessionsSelect as any)   // retry: read winner
        .mockReturnValueOnce(mockWinnerUserSelect as any) // get winner display name
        .mockReturnValueOnce(mockPresenceUpsert as any)   // presence with winner

      const result = await ensureSession(req, res)

      // Assertions: should use winner's userId
      expect(result.userId).toBe(mockWinnerUserId)
      expect(result.sessionId).toBe(mockSessionId)
      expect(result.shouldSetCookie).toBe(true)

      // Verify presence uses winner's data
      expect(mockPresenceUpsert.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: mockWinnerUserId,
          display_name: mockWinnerDisplayName
        }),
        { onConflict: 'session_id' }
      )
    })
  })

  describe('Identity Invariant: Presence NEVER queried for identity', () => {
    it('should lookup sessions table first, not presence', async () => {
      const existingSid = 'session-123'
      const req = createMockRequest({ sid: existingSid })
      const res = createMockResponse()

      const mockSessionsSelect = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { session_id: existingSid, user_id: 'user-123' },
              error: null
            })
          })
        })
      }

      const mockSessionsUpdate = {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      }

      const mockUsersSelect = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { display_name: 'test_user' },
              error: null
            })
          })
        })
      }

      const mockPresenceUpsert = {
        upsert: vi.fn().mockResolvedValue({ data: null, error: null })
      }

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(mockSessionsSelect as any)
        .mockReturnValueOnce(mockSessionsUpdate as any)
        .mockReturnValueOnce(mockUsersSelect as any)
        .mockReturnValueOnce(mockPresenceUpsert as any)

      await ensureSession(req, res)

      // Verify: first table accessed is sessions, NOT presence
      expect(supabaseAdmin.from).toHaveBeenNthCalledWith(1, 'sessions')

      // Verify: presence is upserted (write), not queried (read)
      const presenceCall = vi.mocked(supabaseAdmin.from).mock.calls.find(
        call => call[0] === 'presence'
      )
      expect(presenceCall).toBeDefined()

      // The presence mock should only have .upsert called, not .select
      expect(mockPresenceUpsert.upsert).toHaveBeenCalled()
    })
  })
})
