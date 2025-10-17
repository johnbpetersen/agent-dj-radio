// tests/api/session/whoami-capabilities.test.ts
// Tests for GET /api/session/whoami capabilities field (unconditional gate)

import { describe, it, expect, beforeEach, vi } from 'vitest'
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
function createMockRequest(cookies?: Record<string, string>): VercelRequest {
  const cookieString = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    : undefined

  return {
    headers: {
      'x-forwarded-proto': 'https',
      cookie: cookieString
    },
    method: 'GET',
    body: {},
    query: {},
    url: '/api/session/whoami'
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

describe('GET /api/session/whoami - capabilities (unconditional)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('guest user has canChat: false', async () => {
    const req = createMockRequest({ sid: 'session-123' })
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-guest',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-guest',
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
    } as any)

    await whoamiHandler(req, res)

    expect(res._status).toBe(200)
    expect(res._body.capabilities).toEqual({ canChat: false })
  })

  it('non-ephemeral user has canChat: true', async () => {
    const req = createMockRequest({ sid: 'session-123' })
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-linked',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-linked',
              display_name: 'linked_user',
              ephemeral: false,
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

    expect(res._status).toBe(200)
    expect(res._body.capabilities).toEqual({ canChat: true })
  })

  it('banned user has canChat: false', async () => {
    const req = createMockRequest({ sid: 'session-123' })
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-banned',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-banned',
              display_name: 'banned_user',
              ephemeral: false,
              kind: 'human',
              banned: true,
              created_at: '2025-01-17T10:00:00Z'
            },
            error: null
          })
        })
      })
    } as any)

    await whoamiHandler(req, res)

    expect(res._status).toBe(200)
    expect(res._body.capabilities).toEqual({ canChat: false })
  })
})
