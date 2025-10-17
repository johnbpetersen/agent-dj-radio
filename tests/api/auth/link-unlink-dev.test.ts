// tests/api/auth/link-unlink-dev.test.ts
// Tests for POST /api/auth/link/dev and POST /api/auth/unlink/dev
// Provider-agnostic link/unlink with dev provider

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import linkDevHandler from '../../../api_handlers/auth/link/dev.js'
import unlinkDevHandler from '../../../api_handlers/auth/unlink/dev.js'

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

// Helper to create mock request
function createMockRequest(
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
    body: {},
    query: {},
    url: '/api/auth/link/dev'
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

describe('POST /api/auth/link/dev', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENABLE_EPHEMERAL_USERS = 'true'
  })

  it('links dev provider from guest state (ephemeral=true -> false)', async () => {
    const req = createMockRequest()
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-guest-123',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

    // Mock user fetch (guest)
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-guest-123',
                display_name: 'cosmic_dolphin',
                ephemeral: true,
                banned: false
              },
              error: null
            })
          })
        })
      } as any)
      // Mock insert user_accounts (success - no pre-check SELECT)
      .mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({
          error: null
        })
      } as any)
      // Mock update users.ephemeral
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            error: null
          })
        })
      } as any)

    await linkDevHandler(req, res)

    expect(res._status).toBe(201)
    expect(res._body.userId).toBe('user-guest-123')
    expect(res._body.ephemeral).toBe(false)
    expect(res._body.provider).toBe('dev')
  })

  it('returns 409 ALREADY_LINKED when already linked (23505)', async () => {
    const req = createMockRequest()
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-linked-123',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

    // Mock user fetch
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-linked-123',
                display_name: 'linked_user',
                ephemeral: false,
                banned: false
              },
              error: null
            })
          })
        })
      } as any)
      // Mock insert with unique constraint violation (no pre-check SELECT)
      .mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({
          error: { code: '23505', message: 'duplicate key value violates unique constraint' }
        })
      } as any)

    await linkDevHandler(req, res)

    expect(res._status).toBe(409)
    expect(res._body.error.code).toBe('ALREADY_LINKED')
    expect(res._body.error.message).toContain('already linked')
  })

  it('handles duplicate key message fallback (no code) with 409', async () => {
    const req = createMockRequest()
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-guest-race',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

    // Mock user fetch
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-guest-race',
                display_name: 'racing_user',
                ephemeral: true,
                banned: false
              },
              error: null
            })
          })
        })
      } as any)
      // Mock insert with duplicate key in message (fallback detection)
      .mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({
          error: { message: 'Error: duplicate key value violates unique constraint "user_accounts_pkey"' }
        })
      } as any)

    await linkDevHandler(req, res)

    expect(res._status).toBe(409)
    expect(res._body.error.code).toBe('ALREADY_LINKED')
    expect(res._body.error.message).toContain('already linked')
  })

  it('allows banned users to link (identity operation)', async () => {
    const req = createMockRequest()
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-banned-123',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

    // Mock user fetch (banned)
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-banned-123',
                display_name: 'banned_user',
                ephemeral: true,
                banned: true
              },
              error: null
            })
          })
        })
      } as any)
      // Mock insert user_accounts (success - no pre-check SELECT)
      .mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({
          error: null
        })
      } as any)
      // Mock update users.ephemeral
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            error: null
          })
        })
      } as any)

    await linkDevHandler(req, res)

    expect(res._status).toBe(201)
    expect(res._body.ephemeral).toBe(false)
  })
})

describe('POST /api/auth/unlink/dev', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENABLE_EPHEMERAL_USERS = 'true'
  })

  it('unlinks dev provider (ephemeral=false -> true)', async () => {
    const req = createMockRequest()
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-linked-123',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

    // Mock delete user_accounts row
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              error: null
            })
          })
        })
      } as any)
      // Mock count remaining accounts (0)
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [],
            error: null
          })
        })
      } as any)
      // Mock update users.ephemeral
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            error: null
          })
        })
      } as any)

    await unlinkDevHandler(req, res)

    expect(res._status).toBe(200)
    expect(res._body.userId).toBe('user-linked-123')
    expect(res._body.ephemeral).toBe(true)
    expect(res._body.provider).toBe('dev')
  })

  it('is idempotent (unlink twice returns 200)', async () => {
    const req = createMockRequest()
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-guest-123',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

    // Mock delete (no rows affected, but no error)
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              error: null
            })
          })
        })
      } as any)
      // Mock count remaining accounts (0)
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [],
            error: null
          })
        })
      } as any)
      // Mock update users.ephemeral
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            error: null
          })
        })
      } as any)

    await unlinkDevHandler(req, res)

    expect(res._status).toBe(200)
    expect(res._body.ephemeral).toBe(true)
  })

  it('keeps ephemeral=false if other accounts remain', async () => {
    const req = createMockRequest()
    const res = createMockResponse()

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'user-multi-123',
      sessionId: 'session-123',
      shouldSetCookie: false
    })

    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

    // Mock delete user_accounts row
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              error: null
            })
          })
        })
      } as any)
      // Mock count remaining accounts (1 Discord account remains)
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'account-discord-123' }],
            error: null
          })
        })
      } as any)
      // Mock update users.ephemeral (should be false)
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            error: null
          })
        })
      } as any)

    await unlinkDevHandler(req, res)

    expect(res._status).toBe(200)
    expect(res._body.ephemeral).toBe(false) // Still has other accounts
  })
})

describe('Link/Unlink Lifecycle Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENABLE_EPHEMERAL_USERS = 'true'
  })

  it('preserves userId across link -> unlink -> link cycle', async () => {
    const userId = 'user-lifecycle-123'
    const sessionId = 'session-lifecycle-123'

    const { ensureSession } = await import('../../../api/_shared/session-helpers.js')
    const { supabaseAdmin } = await import('../../../api/_shared/supabase.js')

    // Mock ensureSession to always return same userId/sessionId
    vi.mocked(ensureSession).mockResolvedValue({
      userId,
      sessionId,
      shouldSetCookie: false
    })

    // === LINK 1 ===
    let req = createMockRequest()
    let res = createMockResponse()

    vi.mocked(supabaseAdmin.from)
      // Mock user fetch
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: userId, display_name: 'test_user', ephemeral: true, banned: false },
              error: null
            })
          })
        })
      } as any)
      // Mock insert (success - no pre-check SELECT)
      .mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: null })
      } as any)
      // Mock update ephemeral
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      } as any)

    await linkDevHandler(req, res)
    expect(res._status).toBe(201)
    expect(res._body.userId).toBe(userId)

    // === UNLINK ===
    req = createMockRequest()
    res = createMockResponse()

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        })
      } as any)
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      } as any)
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      } as any)

    await unlinkDevHandler(req, res)
    expect(res._status).toBe(200)
    expect(res._body.userId).toBe(userId)

    // === LINK 2 ===
    req = createMockRequest()
    res = createMockResponse()

    vi.mocked(supabaseAdmin.from)
      // Mock user fetch
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: userId, display_name: 'test_user', ephemeral: true, banned: false },
              error: null
            })
          })
        })
      } as any)
      // Mock insert (success - no pre-check SELECT)
      .mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: null })
      } as any)
      // Mock update ephemeral
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      } as any)

    await linkDevHandler(req, res)
    expect(res._status).toBe(201)
    expect(res._body.userId).toBe(userId)

    // Verify userId never changed
    expect(vi.mocked(ensureSession)).toHaveBeenCalledTimes(3)
  })
})
