// Tests for GET /api/auth/discord/start
// Discord OAuth initiation with PKCE

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { supabaseAdmin } from '../../../../api/_shared/supabase.js'
import { computeCodeChallenge } from '../../../../api/_shared/discord-pkce.js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

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

// Import handler after mocks
const { default: handler } = await import('../../../../api_handlers/auth/discord/start.js')

describe('GET /api/auth/discord/start', () => {
  let mockReq: Partial<VercelRequest>
  let mockRes: Partial<VercelResponse>
  let statusCode: number
  let responseBody: any
  let headers: Record<string, string>
  let sessionCookie: string | undefined

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks()
    statusCode = 200
    responseBody = null
    headers = {}
    sessionCookie = undefined

    // Mock request
    mockReq = {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'x-forwarded-proto': 'http'
      },
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
        if (name.toLowerCase() === 'set-cookie' && value.includes('session_id=')) {
          sessionCookie = value
        }
        return mockRes as VercelResponse
      }),
      getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
      end: vi.fn(() => mockRes as VercelResponse)
    }

    // Mock session helpers to return a fixed session ID
    const { ensureSession, setSessionCookie } = await import('../../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue('test-session-123')
    vi.mocked(setSessionCookie).mockImplementation(() => {})

    // Set default env
    process.env.ENABLE_DISCORD_LINKING = 'true'
    process.env.DISCORD_CLIENT_ID = 'test_client_id_123'
    process.env.DISCORD_REDIRECT_URI = 'http://localhost:3001/api/auth/discord/callback'
    process.env.DISCORD_API_BASE = 'https://discord.com/api'
  })

  describe('Feature flag guard', () => {
    it('returns 404 when ENABLE_DISCORD_LINKING is not true', async () => {
      process.env.ENABLE_DISCORD_LINKING = 'false'

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(404)
      expect(responseBody).toMatchObject({
        error: {
          code: 'FEATURE_DISABLED',
          message: expect.stringContaining('not enabled')
        },
        requestId: expect.any(String)
      })
    })

    it('returns 404 when ENABLE_DISCORD_LINKING is missing', async () => {
      delete process.env.ENABLE_DISCORD_LINKING

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(404)
      expect(responseBody.error.code).toBe('FEATURE_DISABLED')
    })
  })

  describe('Environment validation', () => {
    it('returns 400 when DISCORD_CLIENT_ID is missing', async () => {
      delete process.env.DISCORD_CLIENT_ID

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody).toMatchObject({
        error: {
          code: 'MISSING_CONFIG',
          message: expect.stringContaining('not properly configured'),
          detail: expect.stringContaining('DISCORD_CLIENT_ID')
        },
        requestId: expect.any(String)
      })
    })

    it('returns 400 when DISCORD_CLIENT_ID is empty string', async () => {
      process.env.DISCORD_CLIENT_ID = '   '

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody.error.detail).toContain('DISCORD_CLIENT_ID')
    })

    it('returns 400 when DISCORD_REDIRECT_URI is missing', async () => {
      delete process.env.DISCORD_REDIRECT_URI

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody).toMatchObject({
        error: {
          code: 'MISSING_CONFIG',
          detail: expect.stringContaining('DISCORD_REDIRECT_URI')
        }
      })
    })

    it('returns 400 when DISCORD_REDIRECT_URI is empty string', async () => {
      process.env.DISCORD_REDIRECT_URI = ''

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody.error.detail).toContain('DISCORD_REDIRECT_URI')
    })

    it('uses default DISCORD_API_BASE when not provided', async () => {
      delete process.env.DISCORD_API_BASE

      // Mock successful session and DB insert
      mockReq.cookies = { session_id: 'existing-session-id' }
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody.authorizeUrl).toContain('https://discord.com/api/oauth2/authorize')
    })
  })

  describe('Happy path - JSON response', () => {
    it('returns 200 with authorizeUrl when Accept: application/json', async () => {
      // Mock session exists
      mockReq.cookies = { session_id: 'test-session-123' }

      // Mock successful DB insert
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody).toHaveProperty('authorizeUrl')
      expect(typeof responseBody.authorizeUrl).toBe('string')
      expect(responseBody.authorizeUrl).toContain('discord.com/api/oauth2/authorize')
    })

    it('generates valid authorize URL with all required params', async () => {
      mockReq.cookies = { session_id: 'test-session-123' }

      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      const url = new URL(responseBody.authorizeUrl)

      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('client_id')).toBe('test_client_id_123')
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3001/api/auth/discord/callback')
      expect(url.searchParams.get('scope')).toBe('identify')
      expect(url.searchParams.get('state')).toBeTruthy()
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('code_challenge')).toBeTruthy()
    })

    it('persists state to database with correct session_id', async () => {
      const sessionId = 'test-session-456'

      // Override the default mock for this specific test
      const { ensureSession } = await import('../../../../api/_shared/session-helpers.js')
      vi.mocked(ensureSession).mockResolvedValue(sessionId)

      let insertedRow: any
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row) => {
          insertedRow = row
          return Promise.resolve({ error: null })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(mockFrom).toHaveBeenCalledWith('oauth_states')
      expect(insertedRow).toMatchObject({
        session_id: sessionId,
        provider: 'discord',
        state: expect.any(String),
        code_verifier: expect.any(String),
        created_at: expect.any(String)
      })
      expect(insertedRow.state.length).toBeGreaterThan(30) // Base64url encoded 32 bytes
      expect(insertedRow.code_verifier.length).toBeGreaterThan(30)
    })

    it('verifies code_challenge is valid S256 of stored verifier', async () => {
      let storedVerifier: string
      let returnedState: string

      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation((row) => {
          storedVerifier = row.code_verifier
          returnedState = row.state
          return Promise.resolve({ error: null })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      const url = new URL(responseBody.authorizeUrl)
      const urlState = url.searchParams.get('state')
      const urlChallenge = url.searchParams.get('code_challenge')

      // Verify state matches
      expect(urlState).toBe(returnedState!)

      // Verify challenge is S256(verifier)
      const expectedChallenge = computeCodeChallenge(storedVerifier!)
      expect(urlChallenge).toBe(expectedChallenge)
    })

    it('calls setSessionCookie when session is created', async () => {
      // No existing session
      mockReq.cookies = {}

      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      const { setSessionCookie } = await import('../../../../api/_shared/session-helpers.js')

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      // Verify setSessionCookie was called with session ID
      expect(setSessionCookie).toHaveBeenCalledWith(expect.anything(), 'test-session-123', expect.anything())
    })
  })

  describe('Happy path - HTML redirect', () => {
    it('returns 302 redirect when Accept header is text/html', async () => {
      mockReq.headers!.accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      mockReq.cookies = { session_id: 'test-session-html' }

      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(302)
      expect(headers.location).toBeDefined()
      expect(headers.location).toContain('discord.com/api/oauth2/authorize')
      expect(mockRes.end).toHaveBeenCalled()
    })

    it('returns 302 redirect when Accept header is missing', async () => {
      delete mockReq.headers!.accept
      mockReq.cookies = { session_id: 'test-session-no-accept' }

      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(302)
      expect(headers.location).toBeDefined()
    })

    it('persists state even when redirecting', async () => {
      mockReq.headers!.accept = 'text/html'
      mockReq.cookies = { session_id: 'test-session-redirect' }

      let insertCalled = false
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation(() => {
          insertCalled = true
          return Promise.resolve({ error: null })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(insertCalled).toBe(true)
      expect(mockFrom).toHaveBeenCalledWith('oauth_states')
    })
  })

  describe('Database errors', () => {
    it('returns 503 on DB insert error (non-collision)', async () => {
      mockReq.cookies = { session_id: 'test-session-db-error' }

      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({
          error: {
            code: 'PGRST116',
            message: 'Database connection failed'
          }
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(503) // DB_ERROR maps to 503 (service unavailable)
      expect(responseBody).toMatchObject({
        error: {
          code: 'DB_ERROR',
          message: expect.stringContaining('Failed to initialize OAuth flow')
        },
        requestId: expect.any(String)
      })
    })

    it('retries on state collision (23505) and succeeds on second attempt', async () => {
      mockReq.cookies = { session_id: 'test-session-collision' }

      let attemptCount = 0
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockImplementation(() => {
          attemptCount++
          if (attemptCount === 1) {
            // First attempt: collision
            return Promise.resolve({
              error: { code: '23505', message: 'duplicate key value violates unique constraint' }
            })
          }
          // Second attempt: success
          return Promise.resolve({ error: null })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(attemptCount).toBe(2)
      expect(statusCode).toBe(200)
      expect(responseBody.authorizeUrl).toBeDefined()
    })

    it('returns 500 after max collision retries', async () => {
      mockReq.cookies = { session_id: 'test-session-max-collision' }

      // Always return collision error
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({
          error: { code: '23505', message: 'duplicate key' }
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(500)
      expect(responseBody).toMatchObject({
        error: {
          code: 'DB_ERROR',
          message: expect.stringContaining('after multiple attempts'),
          detail: expect.stringContaining('collision retry limit')
        }
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

    it('returns 405 for PUT request', async () => {
      mockReq.method = 'PUT'

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(405)
    })
  })
})
