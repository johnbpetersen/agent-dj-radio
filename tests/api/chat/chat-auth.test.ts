// tests/api/chat/chat-auth.test.ts
// Tests for POST /api/chat/post - REQUIRE_LINKED_FOR_CHAT gate

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import chatPostHandler from '../../../api_handlers/chat/post.js'

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
    debug: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('../../../api/_shared/session-helpers.js', () => ({
  ensureSession: vi.fn(),
  setSessionCookie: vi.fn()
}))

vi.mock('../../../src/server/rate-limit.js', () => ({
  checkSessionRateLimit: vi.fn(() => ({ allowed: true }))
}))

vi.mock('../../../src/lib/profanity.js', () => ({
  validateChatMessage: vi.fn(() => null) // No validation errors by default
}))

// Helper to create mock request
function createMockRequest(
  body: any,
  headers?: Record<string, string>
): VercelRequest {
  return {
    headers: {
      'x-forwarded-proto': 'https',
      'content-type': 'application/json',
      'x-session-id': 'session-123',
      ...headers
    },
    method: 'POST',
    body,
    query: {},
    url: '/api/chat/post'
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

describe('POST /api/chat/post - REQUIRE_LINKED_FOR_CHAT gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENABLE_EPHEMERAL_USERS = 'true'
    process.env.ENABLE_CHAT_ALPHA = 'true'
    delete process.env.REQUIRE_LINKED_FOR_CHAT
  })

  afterEach(() => {
    delete process.env.REQUIRE_LINKED_FOR_CHAT
    delete process.env.ENABLE_EPHEMERAL_USERS
    delete process.env.ENABLE_CHAT_ALPHA
  })

  describe('Flag OFF (default) - all users can chat', () => {
    it('guest user can post message when flag is OFF', async () => {
      const req = createMockRequest({ message: 'Hello from guest!' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-guest',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

      // Mock user fetch (ephemeral guest)
      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'user-guest',
                  display_name: 'cosmic_dolphin',
                  ephemeral: true,
                  banned: false
                },
                error: null
              })
            })
          })
        } as any)
        // Mock presence query (old flow still used)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  session_id: 'session-123',
                  user_id: 'user-guest',
                  display_name: 'cosmic_dolphin',
                  user: {
                    id: 'user-guest',
                    display_name: 'cosmic_dolphin',
                    banned: false
                  }
                },
                error: null
              })
            })
          })
        } as any)
        // Mock chat message insert
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'msg-123' },
                error: null
              })
            })
          })
        } as any)
        // Mock presence update
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({})
          })
        } as any)
        // Mock user update
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({})
          })
        } as any)

      await chatPostHandler(req, res)

      expect(res._status).toBe(201)
      expect(res._body.ok).toBe(true)
    })

    it('non-ephemeral user can post message when flag is OFF', async () => {
      const req = createMockRequest({ message: 'Hello from linked user!' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-linked',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'user-linked',
                  display_name: 'linked_user',
                  ephemeral: false,
                  banned: false
                },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  session_id: 'session-123',
                  user_id: 'user-linked',
                  display_name: 'linked_user',
                  user: {
                    id: 'user-linked',
                    display_name: 'linked_user',
                    banned: false
                  }
                },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'msg-456' },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({})
          })
        } as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({})
          })
        } as any)

      await chatPostHandler(req, res)

      expect(res._status).toBe(201)
      expect(res._body.ok).toBe(true)
    })
  })

  describe('Flag ON - only non-ephemeral can chat', () => {
    it('guest user gets 403 CHAT_REQUIRES_LINKED when flag is ON', async () => {
      process.env.REQUIRE_LINKED_FOR_CHAT = 'true'

      const req = createMockRequest({ message: 'Hello from guest!' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-guest',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

      // Mock user fetch (ephemeral guest)
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-guest',
                display_name: 'cosmic_dolphin',
                ephemeral: true,
                banned: false
              },
              error: null
            })
          })
        })
      } as any)

      await chatPostHandler(req, res)

      expect(res._status).toBe(403)
      expect(res._body.error.code).toBe('CHAT_REQUIRES_LINKED')
      expect(res._body.error.message).toContain('linked account')
    })

    it('non-ephemeral user can post when flag is ON', async () => {
      process.env.REQUIRE_LINKED_FOR_CHAT = 'true'

      const req = createMockRequest({ message: 'Hello from linked user!' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-linked',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'user-linked',
                  display_name: 'linked_user',
                  ephemeral: false,
                  banned: false
                },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  session_id: 'session-123',
                  user_id: 'user-linked',
                  display_name: 'linked_user',
                  user: {
                    id: 'user-linked',
                    display_name: 'linked_user',
                    banned: false
                  }
                },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'msg-789' },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({})
          })
        } as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({})
          })
        } as any)

      await chatPostHandler(req, res)

      expect(res._status).toBe(201)
      expect(res._body.ok).toBe(true)
    })
  })

  describe('Banned users cannot chat (existing behavior)', () => {
    it('banned user gets 403 regardless of ephemeral status', async () => {
      const req = createMockRequest({ message: 'Hello!' })
      const res = createMockResponse()

      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'user-banned',
        sessionId: 'session-123',
        shouldSetCookie: false
      })

      const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'user-banned',
                  display_name: 'banned_user',
                  ephemeral: false,
                  banned: true
                },
                error: null
              })
            })
          })
        } as any)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  session_id: 'session-123',
                  user_id: 'user-banned',
                  display_name: 'banned_user',
                  user: {
                    id: 'user-banned',
                    display_name: 'banned_user',
                    banned: true
                  }
                },
                error: null
              })
            })
          })
        } as any)

      await chatPostHandler(req, res)

      expect(res._status).toBe(403)
      expect(res._body.error.message).toMatch(/banned/i)
    })
  })

  describe('No session (existing behavior)', () => {
    it('request without X-Session-Id gets 500 due to ensureSession failure', async () => {
      const req = createMockRequest(
        { message: 'Hello!' },
        { 'x-session-id': '' } // Empty session ID
      )
      const res = createMockResponse()

      // Mock ensureSession to throw error for invalid/missing session
      const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockRejectedValue(new Error('Invalid session'))

      await chatPostHandler(req, res)

      expect(res._status).toBe(500)
    })
  })
})
