// tests/api/users/rename.test.ts
// Tests for POST /api/users/rename - collision-safe display name change

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import renameHandler from '../../../api_handlers/users/rename.js'

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
  body: any,
  cookies?: Record<string, string>
): VercelRequest {
  const cookieString = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    : undefined

  return {
    headers: {
      'x-forwarded-proto': 'https',
      'content-type': 'application/json',
      cookie: cookieString
    },
    method: 'POST',
    body,
    query: {},
    url: '/api/users/rename'
  } as any
}

// Helper to create mock response
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

describe('POST /api/users/rename', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ENABLE_RENAME_RL
  })

  afterEach(() => {
    delete process.env.ENABLE_RENAME_RL
  })

  describe('Happy path', () => {
    it('successfully renames user with valid name', async () => {
      const userId = 'user-123'
      const oldName = 'cosmic_dolphin'
      const newName = 'lunar_panda'

      const req = createMockRequest({ displayName: newName }, { sid: 'session-123' })
      const res = createMockResponse()

      // Mock ensureSession
      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId,
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      // Mock user fetch (current state)
      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: userId,
                  display_name: oldName,
                  banned: false
                },
                error: null
              })
            })
          })
        } as any)
        // Mock update success
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: null
            })
          })
        } as any)

      await renameHandler(req, res)

      expect(res._status).toBe(200)
      expect(res._body).toEqual({
        userId,
        displayName: newName
      })
      expect(res._body).not.toHaveProperty('sessionId')
    })
  })

  describe('Validation', () => {
    it('rejects empty display name', async () => {
      const req = createMockRequest({ displayName: '' }, { sid: 'session-123' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-123',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      await renameHandler(req, res)

      expect(res._status).toBe(400)
      expect(res._body.error.message).toContain('required')
    })

    it('rejects name with whitespace', async () => {
      const req = createMockRequest({ displayName: ' cosmic_dolphin ' }, { sid: 'session-123' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-123',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      await renameHandler(req, res)

      expect(res._status).toBe(400)
      expect(res._body.error.message).toContain('whitespace')
    })

    it('rejects name too short', async () => {
      const req = createMockRequest({ displayName: 'ab' }, { sid: 'session-123' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-123',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      await renameHandler(req, res)

      expect(res._status).toBe(400)
      expect(res._body.error.message).toContain('at least 3 characters')
    })

    it('rejects name too long', async () => {
      const req = createMockRequest({ displayName: 'a'.repeat(25) }, { sid: 'session-123' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-123',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      await renameHandler(req, res)

      expect(res._status).toBe(400)
      expect(res._body.error.message).toContain('at most 24 characters')
    })

    it('rejects name with invalid characters', async () => {
      const req = createMockRequest({ displayName: 'Bad-Name!' }, { sid: 'session-123' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-123',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      await renameHandler(req, res)

      expect(res._status).toBe(400)
      expect(res._body.error.message).toContain('lowercase letters, numbers, and underscores')
    })

    it('rejects name with uppercase letters', async () => {
      const req = createMockRequest({ displayName: 'CosmicDolphin' }, { sid: 'session-123' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-123',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      await renameHandler(req, res)

      expect(res._status).toBe(400)
      expect(res._body.error.message).toContain('lowercase letters, numbers, and underscores')
    })
  })

  describe('No-op behavior', () => {
    it('returns 200 when renaming to current name', async () => {
      const userId = 'user-123'
      const currentName = 'cosmic_dolphin'

      const req = createMockRequest({ displayName: currentName }, { sid: 'session-123' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId,
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      // Mock user fetch (current state)
      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: userId,
                display_name: currentName,
                banned: false
              },
              error: null
            })
          })
        })
      } as any)

      await renameHandler(req, res)

      expect(res._status).toBe(200)
      expect(res._body).toEqual({
        userId,
        displayName: currentName
      })

      // Verify no update was called (no-op)
      const fromCalls = vi.mocked(supabaseAdmin.from).mock.calls
      expect(fromCalls.length).toBe(1) // Only select, no update
      expect(fromCalls[0][0]).toBe('users')
    })
  })

  describe('Collision handling', () => {
    it('returns 409 when name is already taken', async () => {
      const userId = 'user-123'
      const oldName = 'cosmic_dolphin'
      const takenName = 'lunar_panda'

      const req = createMockRequest({ displayName: takenName }, { sid: 'session-123' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId,
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      vi.mocked(supabaseAdmin.from)
        // Mock user fetch
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: userId,
                  display_name: oldName,
                  banned: false
                },
                error: null
              })
            })
          })
        } as any)
        // Mock update failure (unique constraint violation)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' }
            })
          })
        } as any)

      await renameHandler(req, res)

      expect(res._status).toBe(409)
      expect(res._body.error.code).toBe('CONFLICT')
      expect(res._body.error.message).toContain('already taken')
    })
  })

  describe('Banned user', () => {
    it('returns 403 when user is banned', async () => {
      const userId = 'user-banned'

      const req = createMockRequest({ displayName: 'new_name' }, { sid: 'session-123' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId,
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: userId,
                display_name: 'old_name',
                banned: true
              },
              error: null
            })
          })
        })
      } as any)

      await renameHandler(req, res)

      expect(res._status).toBe(403)
      expect(res._body.error.message).toMatch(/banned/i) // Case-insensitive
    })
  })

  describe('Rate limiting (optional)', () => {
    it('returns 429 when rate limited (ENABLE_RENAME_RL=true)', async () => {
      process.env.ENABLE_RENAME_RL = 'true'

      const userId = 'user-123'
      const req1 = createMockRequest({ displayName: 'name_one' }, { sid: 'session-123' })
      const res1 = createMockResponse()

      const req2 = createMockRequest({ displayName: 'name_two' }, { sid: 'session-123' })
      const res2 = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId,
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

      // First call: success
      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: userId, display_name: 'old_name', banned: false },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        } as any)

      await renameHandler(req1, res1)
      expect(res1._status).toBe(200)

      // Second call: rate limited
      await renameHandler(req2, res2)
      expect(res2._status).toBe(429)
      expect(res2._body.error.code).toBe('TOO_MANY_REQUESTS')
    })

    it('does not rate limit when ENABLE_RENAME_RL is not set', async () => {
      // Explicitly ensure env var is not set
      delete process.env.ENABLE_RENAME_RL

      const userId = 'user-123'
      const req1 = createMockRequest({ displayName: 'name_one' }, { sid: 'session-123' })
      const res1 = createMockResponse()

      const req2 = createMockRequest({ displayName: 'name_two' }, { sid: 'session-123' })
      const res2 = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId,
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

      // First call
      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: userId, display_name: 'old_name', banned: false },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        } as any)

      await renameHandler(req1, res1)
      expect(res1._status).toBe(200)

      // Second call: should also succeed (no rate limit)
      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: userId, display_name: 'name_one', banned: false },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        } as any)

      await renameHandler(req2, res2)
      expect(res2._status).toBe(200)
    })
  })

  describe('Method restrictions', () => {
    it('GET returns 400 Method Not Allowed', async () => {
      const req = {
        headers: { 'x-forwarded-proto': 'https' },
        method: 'GET',
        body: {},
        query: {},
        url: '/api/users/rename'
      } as any

      const res = createMockResponse()

      await renameHandler(req, res)

      expect(res._status).toBe(400)
      expect(res._body.error.message).toMatch(/POST|Method not allowed/i)
    })
  })
})
