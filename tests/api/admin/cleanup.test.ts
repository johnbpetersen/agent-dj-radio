/**
 * Tests for GET /api/admin/cleanup/oauth-states
 * Admin-protected endpoint to delete stale OAuth states
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../../../api_handlers/admin/cleanup.js'
import { supabaseAdmin } from '../../../api/_shared/supabase.js'

vi.mock('../../../api/_shared/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn()
  }
}))

describe('GET /api/admin/cleanup/oauth-states', () => {
  let mockReq: Partial<VercelRequest>
  let mockRes: Partial<VercelResponse>
  let statusCode: number
  let responseBody: any
  let headers: Record<string, string>

  beforeEach(() => {
    // Reset environment
    process.env.ADMIN_TOKEN = 'test-admin-token-secret'

    // Reset mocks
    vi.clearAllMocks()

    // Create mock request
    mockReq = {
      method: 'GET',
      headers: {
        'x-admin-token': 'test-admin-token-secret'
      },
      url: '/api/admin/cleanup/oauth-states'
    }

    // Create mock response
    statusCode = 0
    responseBody = undefined
    headers = {}

    mockRes = {
      status: vi.fn().mockImplementation((code: number) => {
        statusCode = code
        return mockRes
      }),
      json: vi.fn().mockImplementation((body: any) => {
        responseBody = body
        return mockRes
      }),
      setHeader: vi.fn().mockImplementation((key: string, value: string) => {
        headers[key.toLowerCase()] = value
        return mockRes
      }),
      end: vi.fn()
    } as any
  })

  describe('Authentication', () => {
    it('returns 401 when ADMIN_TOKEN is not configured', async () => {
      delete process.env.ADMIN_TOKEN

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(401)
      expect(responseBody).toMatchObject({
        error: {
          code: 'UNAUTHORIZED',
          message: expect.stringContaining('not configured')
        }
      })
    })

    it('returns 401 when ADMIN_TOKEN is empty string', async () => {
      process.env.ADMIN_TOKEN = ''

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(401)
      expect(responseBody.error.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 when x-admin-token header is missing', async () => {
      delete mockReq.headers!['x-admin-token']

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(401)
      expect(responseBody).toMatchObject({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid admin token'
        },
        requestId: expect.any(String)
      })
    })

    it('returns 401 when x-admin-token header does not match', async () => {
      mockReq.headers!['x-admin-token'] = 'wrong-token'

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(401)
      expect(responseBody.error.code).toBe('UNAUTHORIZED')
      expect(responseBody.error.message).toContain('Invalid admin token')
    })

    it('allows request when token matches', async () => {
      // Mock successful cleanup
      const mockFrom = vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: [],
              error: null
            })
          })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
    })
  })

  describe('Happy path', () => {
    it('deletes stale OAuth states and returns count', async () => {
      const deletedStates = [
        { id: 'state-1' },
        { id: 'state-2' },
        { id: 'state-3' }
      ]

      const mockFrom = vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: deletedStates,
              error: null
            })
          })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody).toEqual({
        deleted: 3
      })
      expect(mockFrom).toHaveBeenCalledWith('oauth_states')
    })

    it('returns 0 when no stale states found', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: [],
              error: null
            })
          })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody).toEqual({
        deleted: 0
      })
    })

    it('handles null data from database', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: null,
              error: null
            })
          })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody).toEqual({
        deleted: 0
      })
    })

    it('uses correct cutoff time (1 day ago)', async () => {
      const now = Date.now()
      const oneDayMs = 24 * 60 * 60 * 1000
      let capturedCutoff: string

      const mockFrom = vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          lt: vi.fn().mockImplementation((column: string, value: string) => {
            capturedCutoff = value
            return {
              select: vi.fn().mockResolvedValue({
                data: [],
                error: null
              })
            }
          })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)

      // Verify cutoff is approximately 1 day ago (within 5 second tolerance)
      const cutoffTime = new Date(capturedCutoff!).getTime()
      const expectedCutoff = now - oneDayMs
      const diff = Math.abs(cutoffTime - expectedCutoff)
      expect(diff).toBeLessThan(5000) // 5 second tolerance
    })
  })

  describe('Database errors', () => {
    it('returns 500 on database error', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: 'PGRST116',
                message: 'Database connection failed'
              }
            })
          })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(500)
      expect(responseBody).toMatchObject({
        error: {
          code: 'DB_ERROR',
          message: 'Failed to delete stale OAuth states'
        },
        requestId: expect.any(String)
      })
    })

    it('returns 500 on unexpected exception', async () => {
      const mockFrom = vi.fn().mockImplementation(() => {
        throw new Error('Unexpected database error')
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(500)
      expect(responseBody).toMatchObject({
        error: {
          code: 'INTERNAL',
          message: 'An unexpected error occurred'
        },
        requestId: expect.any(String)
      })
    })
  })

  describe('Method validation', () => {
    it('returns 405 for POST request', async () => {
      mockReq.method = 'POST'

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(405)
      expect(responseBody).toMatchObject({
        error: 'Method not allowed'
      })
    })

    it('returns 405 for DELETE request', async () => {
      mockReq.method = 'DELETE'

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(405)
    })
  })
})
