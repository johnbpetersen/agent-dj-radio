// tests/api/session/whoami.test.ts
// Tests for /api/session/whoami - read-only identity endpoint

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import whoamiHandler from '../../../api_handlers/session/whoami.js'

// Mock dependencies
vi.mock('../../../api/_shared/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn()
  }
}))

vi.mock('../../../src/lib/logger.js', () => ({
  generateCorrelationId: vi.fn(() => 'mock-uuid-' + Date.now()),
  logger: {
    request: vi.fn(),
    requestComplete: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('../../../api/_shared/session-helpers.js', () => ({
  ensureSession: vi.fn(),
  setSessionCookie: vi.fn()
}))

// Helper to create mock request
function createMockRequest(
  method: 'GET' | 'POST' = 'POST',
  cookies?: Record<string, string>,
  headers?: Record<string, string>
): VercelRequest {
  const cookieString = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    : undefined

  return {
    headers: {
      'x-forwarded-proto': 'https',
      cookie: cookieString,
      ...headers
    },
    method,
    body: {},
    query: {},
    url: '/api/session/whoami'
  } as any
}

// Helper to create mock response with header tracking
function createMockResponse(): VercelResponse & {
  _headers: Map<string, string | string[]>
  _status: number
  _body: any
} {
  const headers = new Map<string, string | string[]>()
  const state = { status: 200, body: null as any }

  const res = {
    _headers: headers,
    get _status() { return state.status },
    get _body() { return state.body },
    setHeader: vi.fn((name: string, value: string | string[]) => {
      headers.set(name, value)
    }),
    getHeader: vi.fn((name: string) => headers.get(name)),
    status: vi.fn((code: number) => {
      state.status = code
      return res
    }),
    json: vi.fn((data: any) => {
      state.body = data
    }),
    send: vi.fn()
  } as any

  return res
}

describe('/api/session/whoami', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DEBUG_AUTH
  })

  afterEach(() => {
    delete process.env.DEBUG_AUTH
  })

  describe('Existing session', () => {
    it('returns identity for valid session cookie', async () => {
      const existingSessionId = 'session-existing-123'
      const existingUserId = 'user-existing-456'

      const req = createMockRequest('POST', { sid: existingSessionId })
      const res = createMockResponse()

      // Mock ensureSession to return existing session (no cookie needed)
      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: existingUserId,
        sessionId: existingSessionId,
        shouldSetCookie: false
      })

      // Mock user fetch for response
      const mockUsersFetch = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: existingUserId,
                display_name: 'cosmic_dolphin',
                ephemeral: true,
                kind: 'human',
                banned: false,
                created_at: '2025-01-17T10:00:00Z'
              },
              error: null
            })
          })
        })
      }

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce(mockUsersFetch as any)

      await whoamiHandler(req, res)

      // Assertions
      expect(res._body).toEqual({
        userId: existingUserId,
        displayName: 'cosmic_dolphin',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z'
      })

      // Should NOT set cookie (cookie already present)
      const { setSessionCookie } = await import('../../../api/_shared/session-helpers.js')
      expect(setSessionCookie).not.toHaveBeenCalled()
    })

    it('does not include sessionId in response by default', async () => {
      const req = createMockRequest('POST', { sid: 'session-123' })
      const res = createMockResponse()

      // Mock ensureSession
      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-123',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      // Mock user fetch
      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-123',
                display_name: 'test_user',
                ephemeral: true,
                kind: 'human',
                banned: false,
                created_at: '2025-01-17T10:00:00Z'
              },
              error: null
            })
          })
        })
      } as any)

      await whoamiHandler(req, res)

      expect(res._body).not.toHaveProperty('sessionId')
    })

    it('includes sessionId when DEBUG_AUTH=1', async () => {
      process.env.DEBUG_AUTH = '1'

      const req = createMockRequest('POST', { sid: 'session-debug-123' })
      const res = createMockResponse()

      // Mock ensureSession
      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-123',
        sessionId: 'session-debug-123',
        shouldSetCookie: false
      })

      // Mock user fetch
      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-123',
                display_name: 'test_user',
                ephemeral: true,
                kind: 'human',
                banned: false,
                created_at: '2025-01-17T10:00:00Z'
              },
              error: null
            })
          })
        })
      } as any)

      await whoamiHandler(req, res)

      expect(res._body).toHaveProperty('sessionId', 'session-debug-123')
    })
  })

  describe('First visit (no cookie)', () => {
    it('creates new session and returns identity with Set-Cookie', async () => {
      const req = createMockRequest('POST') // No cookie
      const res = createMockResponse()

      const mockUserId = 'user-new-789'
      const mockSessionId = 'session-new-101'
      const mockDisplayName = 'happy_raccoon'

      // Mock ensureSession to return new session (needs cookie)
      const { ensureSession, setSessionCookie } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: mockUserId,
        sessionId: mockSessionId,
        shouldSetCookie: true
      })

      // Mock user fetch for response
      const mockUsersFetch = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: mockUserId,
                display_name: mockDisplayName,
                ephemeral: true,
                kind: 'human',
                banned: false,
                created_at: '2025-01-17T12:00:00Z'
              },
              error: null
            })
          })
        })
      }

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce(mockUsersFetch as any)

      await whoamiHandler(req, res)

      // Assertions: identity returned
      expect(res._body).toEqual({
        userId: mockUserId,
        displayName: mockDisplayName,
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T12:00:00Z'
      })

      // Should set cookie on first visit
      expect(setSessionCookie).toHaveBeenCalledWith(res, mockSessionId, req)
    })
  })

  describe('Never queries presence for identity', () => {
    it('resolves identity via sessions → users only', async () => {
      const req = createMockRequest('POST', { sid: 'session-123' })
      const res = createMockResponse()

      // Mock ensureSession (it handles the sessions/presence logic)
      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-123',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      // Track which tables whoami handler queries directly
      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      const queriedTables: string[] = []

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        queriedTables.push(table)

        if (table === 'users') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'user-123',
                    display_name: 'test_user',
                    ephemeral: true,
                    kind: 'human',
                    banned: false,
                    created_at: '2025-01-17T10:00:00Z'
                  },
                  error: null
                })
              })
            })
          } as any
        }

        return {} as any
      })

      await whoamiHandler(req, res)

      // Verify: whoami handler ONLY queries users table, never presence
      // (ensureSession may query presence, but that's tested separately)
      expect(queriedTables).toEqual(['users'])
      expect(queriedTables).not.toContain('presence')
    })
  })

  describe('Supports GET and POST', () => {
    it('GET returns same shape as POST', async () => {
      const sessionId = 'session-same-123'
      const userId = 'user-same-456'

      // Test POST
      const reqPost = createMockRequest('POST', { sid: sessionId })
      const resPost = createMockResponse()

      // Test GET
      const reqGet = createMockRequest('GET', { sid: sessionId })
      const resGet = createMockResponse()

      // Mock ensureSession for POST
      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId,
        sessionId,
        shouldSetCookie: false
      })

      // Mock user fetch for POST
      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      vi.mocked(supabaseAdmin.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: userId,
                display_name: 'test_user',
                ephemeral: true,
                kind: 'human',
                banned: false,
                created_at: '2025-01-17T10:00:00Z'
              },
              error: null
            })
          })
        })
      } as any)

      await whoamiHandler(reqPost, resPost)

      vi.clearAllMocks()

      // Mock same for GET
      vi.mocked(ensureSession).mockResolvedValue({
        userId,
        sessionId,
        shouldSetCookie: false
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: userId,
                display_name: 'test_user',
                ephemeral: true,
                kind: 'human',
                banned: false,
                created_at: '2025-01-17T10:00:00Z'
              },
              error: null
            })
          })
        })
      } as any)

      await whoamiHandler(reqGet, resGet)

      // Both should return identical payloads
      expect(resPost._body).toEqual(resGet._body)
    })
  })
})
