// Tests for POST /api/auth/discord/unlink
// Discord account unlinking with idempotency and ephemeral recalculation

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { supabaseAdmin } from '../../../../api/_shared/supabase.js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { makeSelectEqSingle } from '../../../helpers/supabaseChain.js'

// Mock dependencies
vi.mock('../../../../api/_shared/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn()
  }
}))

vi.mock('../../../../api/_shared/session-helpers.js', () => ({
  ensureSession: vi.fn(),
  setSessionCookie: vi.fn()
}))

vi.mock('../../../../src/lib/logger.js', () => ({
  generateCorrelationId: vi.fn(() => 'mock-correlation-id'),
  logger: {
    request: vi.fn(),
    requestComplete: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

// Import handler and mocked functions after mocks
const { default: handler } = await import('../../../../api_handlers/auth/discord/unlink.js')
const { ensureSession, setSessionCookie } = await import('../../../../api/_shared/session-helpers.js')

describe('POST /api/auth/discord/unlink', () => {
  let mockReq: Partial<VercelRequest>
  let mockRes: Partial<VercelResponse>
  let statusCode: number
  let responseBody: any
  let headers: Record<string, string>

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks()
    statusCode = 200
    responseBody = null
    headers = {}

    // Mock request (default JSON mode)
    mockReq = {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'x-forwarded-proto': 'http'
      },
      query: {},
      cookies: {}
    }

    // Mock response
    mockRes = {
      status: vi.fn((code: number) => {
        statusCode = code
        return mockRes as VercelResponse
      }),
      json: vi.fn((body: any) => {
        responseBody = body
        return mockRes as VercelResponse
      }),
      setHeader: vi.fn((name: string, value: string) => {
        headers[name.toLowerCase()] = value
        return mockRes as VercelResponse
      }),
      getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
      end: vi.fn(() => mockRes as VercelResponse)
    }

    // Mock session helpers
    vi.mocked(ensureSession).mockResolvedValue({
      userId: 'test-user-123',
      sessionId: 'test-session-123',
      shouldSetCookie: false
    })
    vi.mocked(setSessionCookie).mockImplementation(() => {})

    // Set default env
    process.env.ALLOW_DISCORD_UNLINK = 'true'
    process.env.VITE_SITE_URL = 'http://localhost:5173'
  })

  describe('Feature flag', () => {
    it('should return 404 when feature flag is disabled', async () => {
      process.env.ALLOW_DISCORD_UNLINK = 'false'

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(404)
      expect(responseBody).toEqual({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Discord unlinking is not enabled'
        },
        requestId: 'mock-correlation-id'
      })
    })

    it('should return 404 when feature flag is missing', async () => {
      delete process.env.ALLOW_DISCORD_UNLINK

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(404)
      expect(responseBody).toEqual({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Discord unlinking is not enabled'
        },
        requestId: 'mock-correlation-id'
      })
    })
  })

  describe('Method validation', () => {
    it('should reject non-POST methods', async () => {
      mockReq.method = 'GET'

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(405)
      expect(responseBody).toEqual({ error: 'Method not allowed' })
    })
  })

  describe('Unlinking (JSON mode)', () => {
    it('should unlink Discord account and set ephemeral=true when last account', async () => {
      // Mock delete: returns deleted account
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({
          data: [{ id: 'account-uuid-123' }],
          error: null
        })
      }
      const deleteFn = vi.fn(() => deleteChain)

      // Mock count: returns 0 remaining accounts
      const { select: countSelect } = makeSelectEqSingle({
        data: null,
        error: null
      })
      // Override count to return 0
      const countChain: any = {
        eq: vi.fn(() => countChain),
        head: true,
        count: 0
      }
      vi.mocked(countSelect).mockReturnValue(countChain)

      // Mock update: sets ephemeral=true
      const updateChain: any = {
        eq: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      }
      const updateFn = vi.fn(() => updateChain)

      // Setup from() mock for all three tables
      vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 1) {
          return { delete: deleteFn } as any
        }
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 2) {
          return { select: countSelect } as any
        }
        if (table === 'users') {
          return { update: updateFn } as any
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody).toEqual({
        unlinked: true,
        alreadyUnlinked: false,
        remainingAccounts: 0,
        ephemeral: true
      })

      // Verify delete was called
      expect(deleteFn).toHaveBeenCalled()
      expect(deleteChain.eq).toHaveBeenCalledWith('user_id', 'test-user-123')
      expect(deleteChain.eq).toHaveBeenCalledWith('provider', 'discord')

      // Verify update was called with ephemeral=true
      expect(updateFn).toHaveBeenCalledWith({ ephemeral: true })
      expect(updateChain.eq).toHaveBeenCalledWith('id', 'test-user-123')
    })

    it('should unlink and keep ephemeral=false when other accounts remain', async () => {
      // Mock delete: returns deleted account
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({
          data: [{ id: 'account-uuid-123' }],
          error: null
        })
      }
      const deleteFn = vi.fn(() => deleteChain)

      // Mock count: returns 1 remaining account (e.g., wallet)
      const countChain: any = {
        eq: vi.fn().mockResolvedValue({
          count: 1,
          error: null
        })
      }
      const countSelect = vi.fn(() => countChain)

      // Mock update
      const updateChain: any = {
        eq: vi.fn().mockResolvedValue({ data: null, error: null })
      }
      const updateFn = vi.fn(() => updateChain)

      // Mock the actual count query result
      vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 1) {
          return { delete: deleteFn } as any
        }
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 2) {
          return { select: countSelect } as any
        }
        if (table === 'users') {
          return { update: updateFn } as any
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody).toEqual({
        unlinked: true,
        alreadyUnlinked: false,
        remainingAccounts: 1,
        ephemeral: false
      })
    })

    it('should be idempotent when Discord already unlinked', async () => {
      // Mock delete: returns empty array (nothing deleted)
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({
          data: [],
          error: null
        })
      }
      const deleteFn = vi.fn(() => deleteChain)

      // Mock count: returns 0 accounts
      const countChain: any = {
        eq: vi.fn().mockResolvedValue({
          count: 0,
          error: null
        })
      }
      const countSelect = vi.fn(() => countChain)

      // Mock update
      const updateChain: any = {
        eq: vi.fn().mockResolvedValue({ data: null, error: null })
      }
      const updateFn = vi.fn(() => updateChain)

      vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 1) {
          return { delete: deleteFn } as any
        }
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 2) {
          return { select: countSelect } as any
        }
        if (table === 'users') {
          return { update: updateFn } as any
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody).toEqual({
        unlinked: true,
        alreadyUnlinked: true,
        remainingAccounts: 0,
        ephemeral: true
      })
    })
  })

  describe('Unlinking (Redirect mode)', () => {
    beforeEach(() => {
      // Switch to redirect mode (no Accept: application/json)
      mockReq.headers = {
        'x-forwarded-proto': 'http'
      }
    })

    it('should redirect on successful unlink', async () => {
      // Mock delete: returns deleted account
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({
          data: [{ id: 'account-uuid-123' }],
          error: null
        })
      }
      const deleteFn = vi.fn(() => deleteChain)

      // Mock count
      const countChain: any = {
        eq: vi.fn().mockResolvedValue({
          count: 0,
          error: null
        })
      }
      const countSelect = vi.fn(() => countChain)

      // Mock update
      const updateChain: any = {
        eq: vi.fn().mockResolvedValue({ data: null, error: null })
      }
      const updateFn = vi.fn(() => updateChain)

      vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 1) {
          return { delete: deleteFn } as any
        }
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 2) {
          return { select: countSelect } as any
        }
        if (table === 'users') {
          return { update: updateFn } as any
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('http://localhost:5173/?discord_unlinked=1')
      expect(mockRes.end).toHaveBeenCalled()
    })

    it('should redirect with error on database failure', async () => {
      // Mock delete with error
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '23000', message: 'Database error' }
        })
      }

      vi.spyOn(supabaseAdmin, 'from').mockReturnValue({
        delete: vi.fn(() => deleteChain)
      } as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('http://localhost:5173/?discord_error=UNLINK_FAILED')
      expect(mockRes.end).toHaveBeenCalled()
    })
  })

  describe('Error handling (JSON mode)', () => {
    it('should return 503 on delete error', async () => {
      // Mock delete with error
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '23000', message: 'Database error' }
        })
      }

      vi.spyOn(supabaseAdmin, 'from').mockReturnValue({
        delete: vi.fn(() => deleteChain)
      } as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(503)
      expect(responseBody.error.code).toBe('DB_ERROR')
      expect(responseBody.error.message).toContain('Failed to unlink Discord account')
    })

    it('should return 503 on count error', async () => {
      // Mock delete: success
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({
          data: [{ id: 'account-uuid-123' }],
          error: null
        })
      }
      const deleteFn = vi.fn(() => deleteChain)

      // Mock count with error
      const countChain: any = {
        eq: vi.fn().mockResolvedValue({
          count: null,
          error: { code: '23000', message: 'Database error' }
        })
      }
      const countSelect = vi.fn(() => countChain)

      vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 1) {
          return { delete: deleteFn } as any
        }
        if (table === 'user_accounts') {
          return { select: countSelect } as any
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(503)
      expect(responseBody.error.code).toBe('DB_ERROR')
      expect(responseBody.error.message).toContain('Failed to check remaining accounts')
    })

    it('should return 503 on update error', async () => {
      // Mock delete: success
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({
          data: [{ id: 'account-uuid-123' }],
          error: null
        })
      }
      const deleteFn = vi.fn(() => deleteChain)

      // Mock count: success
      const countChain: any = {
        eq: vi.fn().mockResolvedValue({
          count: 0,
          error: null
        })
      }
      const countSelect = vi.fn(() => countChain)

      // Mock update with error
      const updateChain: any = {
        eq: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '23000', message: 'Database error' }
        })
      }
      const updateFn = vi.fn(() => updateChain)

      vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 1) {
          return { delete: deleteFn } as any
        }
        if (table === 'user_accounts') {
          return { select: countSelect } as any
        }
        if (table === 'users') {
          return { update: updateFn } as any
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(503)
      expect(responseBody.error.code).toBe('DB_ERROR')
      expect(responseBody.error.message).toContain('Failed to update user status')
    })
  })

  describe('Session handling', () => {
    it('should set cookie when shouldSetCookie is true', async () => {
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'test-user-123',
        sessionId: 'test-session-123',
        shouldSetCookie: true
      })

      // Setup minimal successful mock
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      }
      const countChain: any = { eq: vi.fn(() => countChain) }
      const countSelect = vi.fn(() => countChain)
      vi.mocked(countSelect).mockReturnValue(Promise.resolve({ count: 0, error: null }) as any)
      const updateChain: any = {
        eq: vi.fn().mockResolvedValue({ data: null, error: null })
      }

      vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 1) {
          return { delete: vi.fn(() => deleteChain) } as any
        }
        if (table === 'user_accounts') {
          return { select: countSelect } as any
        }
        if (table === 'users') {
          return { update: vi.fn(() => updateChain) } as any
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(setSessionCookie).toHaveBeenCalledWith(mockRes, 'test-session-123', mockReq)
    })

    it('should not set cookie when shouldSetCookie is false', async () => {
      vi.mocked(ensureSession).mockResolvedValue({
        userId: 'test-user-123',
        sessionId: 'test-session-123',
        shouldSetCookie: false
      })

      // Setup minimal successful mock
      const deleteChain: any = {
        eq: vi.fn(() => deleteChain),
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      }
      const countChain: any = { eq: vi.fn(() => countChain) }
      const countSelect = vi.fn(() => countChain)
      vi.mocked(countSelect).mockReturnValue(Promise.resolve({ count: 0, error: null }) as any)
      const updateChain: any = {
        eq: vi.fn().mockResolvedValue({ data: null, error: null })
      }

      vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
        if (table === 'user_accounts' && vi.mocked(supabaseAdmin.from).mock.calls.length === 1) {
          return { delete: vi.fn(() => deleteChain) } as any
        }
        if (table === 'user_accounts') {
          return { select: countSelect } as any
        }
        if (table === 'users') {
          return { update: vi.fn(() => updateChain) } as any
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(setSessionCookie).not.toHaveBeenCalled()
    })
  })
})
