// Tests for GET /api/auth/discord/callback
// Discord OAuth callback handler with PKCE verification

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

// Mock Discord API functions
vi.mock('../../../../api/_shared/discord-api.js', () => ({
  exchangeCodeForToken: vi.fn(),
  fetchDiscordUser: vi.fn()
}))

// Import handler and mocked functions after mocks
const { default: handler } = await import('../../../../api_handlers/auth/discord/callback.js')
const { exchangeCodeForToken, fetchDiscordUser } = await import('../../../../api/_shared/discord-api.js')

describe('GET /api/auth/discord/callback', () => {
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

    // Mock request
    mockReq = {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'x-forwarded-proto': 'http'
      },
      query: {
        code: 'test_auth_code_123',
        state: 'test_state_abc'
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
        return mockRes as VercelResponse
      }),
      getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
      end: vi.fn(() => mockRes as VercelResponse)
    }

    // Mock session helpers
    const { ensureSession, setSessionCookie } = await import('../../../../api/_shared/session-helpers.js')
    vi.mocked(ensureSession).mockResolvedValue('test-session-123')
    vi.mocked(setSessionCookie).mockImplementation(() => {})

    // Set default env
    process.env.ENABLE_DISCORD_LINKING = 'true'
    process.env.DISCORD_CLIENT_ID = 'test_client_id_123'
    process.env.DISCORD_CLIENT_SECRET = 'test_client_secret_456'
    process.env.DISCORD_REDIRECT_URI = 'http://localhost:3001/api/auth/discord/callback'
    process.env.DISCORD_API_BASE = 'https://discord.com/api'
    process.env.VITE_SITE_URL = 'http://localhost:5173'
    process.env.OAUTH_STATE_TTL_SEC = '600'
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
  })

  describe('Environment validation', () => {
    it('returns 400 when DISCORD_CLIENT_ID is missing', async () => {
      delete process.env.DISCORD_CLIENT_ID

      // Mock state exists (uses helper - supports any number of .eq() calls)
      const { select } = makeSelectEqSingle({
        data: {
          id: 'state-id-123',
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody.error.code).toBe('BAD_REQUEST')
      expect(responseBody.error.message).toContain('not properly configured')
    })
  })

  describe('Query parameter validation', () => {
    it('returns 400 when code is missing', async () => {
      delete mockReq.query!.code

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody.error.code).toBe('BAD_REQUEST')
      expect(responseBody.error.message).toContain('authorization code')
    })

    it('returns 400 when state is missing', async () => {
      delete mockReq.query!.state

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody.error.code).toBe('BAD_REQUEST')
      expect(responseBody.error.message).toContain('state')
    })

    it('handles Discord OAuth error param', async () => {
      mockReq.query = {
        error: 'access_denied',
        error_description: 'User cancelled the authorization'
      }

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody.error.message).toContain('User cancelled')
    })
  })

  describe('State validation', () => {
    it('returns 400 when state not found in database', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST116', message: 'Not found' }
              })
            })
          })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody.error.code).toBe('INVALID_STATE')
    })

    it('returns 400 when state is expired', async () => {
      // Create expired state (created 601 seconds ago, TTL is 600)
      const expiredTime = new Date(Date.now() - 601 * 1000).toISOString()

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'state-id-123',
                  session_id: 'test-session-123',
                  code_verifier: 'test-verifier',
                  created_at: expiredTime
                },
                error: null
              })
            })
          })
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody.error.code).toBe('EXPIRED_STATE')
    })

    it('returns 400 when state session mismatch', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'state-id-123',
                  session_id: 'different-session-456', // Wrong session
                  code_verifier: 'test-verifier',
                  created_at: new Date().toISOString()
                },
                error: null
              })
            })
          })
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(400)
      expect(responseBody.error.code).toBe('WRONG_SESSION')
    })

    it('deletes state even on errors after validation', async () => {
      let deleteCalled = false
      const stateId = 'state-id-to-delete'

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: stateId,
                      session_id: 'test-session-123',
                      code_verifier: 'test-verifier',
                      created_at: new Date().toISOString()
                    },
                    error: null
                  })
                })
              })
            }),
            delete: vi.fn().mockImplementation(() => {
              deleteCalled = true
              return {
                eq: vi.fn().mockResolvedValue({ error: null })
              }
            })
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      // Mock token exchange to fail
      vi.mocked(exchangeCodeForToken).mockRejectedValue(new Error('Network error'))

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      // Should fail but still delete state
      expect(statusCode).not.toBe(200)
      expect(deleteCalled).toBe(true)
    })
  })

  describe('Discord API errors', () => {
    beforeEach(() => {
      // Setup valid state for all Discord API tests
      const { select } = makeSelectEqSingle({
        data: {
          id: 'state-id-123',
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select,
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)
    })

    it('returns 502 on token exchange 4xx error', async () => {
      const error = new Error('Invalid grant')
      ;(error as any).code = 'UPSTREAM_4XX'
      ;(error as any).httpStatus = 502

      vi.mocked(exchangeCodeForToken).mockRejectedValue(error)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(502)
      expect(responseBody.error.code).toBe('UPSTREAM_4XX')
    })

    it('returns 503 on token exchange 5xx error', async () => {
      const error = new Error('Discord unavailable')
      ;(error as any).code = 'UPSTREAM_5XX'
      ;(error as any).httpStatus = 503

      vi.mocked(exchangeCodeForToken).mockRejectedValue(error)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(503)
      expect(responseBody.error.code).toBe('UPSTREAM_5XX')
    })

    it('returns 503 on network error', async () => {
      const error = new Error('Failed to connect')
      ;(error as any).code = 'NETWORK_ERROR'
      ;(error as any).httpStatus = 503

      vi.mocked(exchangeCodeForToken).mockRejectedValue(error)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(503)
      expect(responseBody.error.code).toBe('NETWORK_ERROR')
    })

    it('returns 502 on user fetch 401 error', async () => {
      vi.mocked(exchangeCodeForToken).mockResolvedValue({
        access_token: 'test_token_123',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identify'
      })

      const error = new Error('Unauthorized')
      ;(error as any).code = 'UPSTREAM_4XX'
      ;(error as any).httpStatus = 502

      vi.mocked(fetchDiscordUser).mockRejectedValue(error)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(502)
      expect(responseBody.error.code).toBe('UPSTREAM_4XX')
    })
  })

  describe('Account linking - Happy path', () => {
    beforeEach(() => {
      // Mock successful Discord API calls
      vi.mocked(exchangeCodeForToken).mockResolvedValue({
        access_token: 'test_token_123',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identify'
      })

      vi.mocked(fetchDiscordUser).mockResolvedValue({
        id: '123456789',
        username: 'testuser',
        discriminator: '0',
        global_name: 'Test User',
        avatar: 'avatar_hash_123'
      })
    })

    it('links account successfully (JSON mode)', async () => {
      const stateId = 'state-id-123'
      const userId = 'user-id-456'
      let stateDeleted = false

      // Mock oauth_states with helper
      const { select: oauthSelect } = makeSelectEqSingle({
        data: {
          id: stateId,
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })

      // Mock sessions with helper
      const { select: sessionSelect } = makeSelectEqSingle({
        data: { user_id: userId },
        error: null
      })

      // Mock users update with helper (needs .eq().eq() chain)
      const { chain: usersChain } = makeSelectEqSingle({ error: null })

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select: oauthSelect,
            delete: vi.fn().mockImplementation(() => {
              stateDeleted = true
              return {
                eq: vi.fn().mockResolvedValue({ error: null })
              }
            })
          }
        }
        if (table === 'sessions') {
          return {
            select: sessionSelect
          }
        }
        if (table === 'user_accounts') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        if (table === 'users') {
          return {
            update: vi.fn(() => usersChain)
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody).toMatchObject({
        success: true,
        userId,
        provider: 'discord',
        discordUser: {
          id: '123456789',
          username: 'testuser',
          global_name: 'Test User'
        }
      })
      expect(stateDeleted).toBe(true)
    })

    it('links account successfully (redirect mode)', async () => {
      // Change Accept header to trigger redirect
      mockReq.headers!.accept = 'text/html,application/xhtml+xml'

      // Mock oauth_states with helper
      const { select: oauthSelect } = makeSelectEqSingle({
        data: {
          id: 'state-id-123',
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })

      // Mock sessions with helper
      const { select: sessionSelect } = makeSelectEqSingle({
        data: { user_id: 'user-id-456' },
        error: null
      })

      // Mock users update with helper (needs .eq().eq() chain)
      const { chain: usersChain } = makeSelectEqSingle({ error: null })

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select: oauthSelect,
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        if (table === 'sessions') {
          return {
            select: sessionSelect
          }
        }
        if (table === 'user_accounts') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        if (table === 'users') {
          return {
            update: vi.fn(() => usersChain)
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('http://localhost:5173/?discord_linked=1')
    })

    it('supports ?format=json query param override', async () => {
      // HTML Accept header but JSON format param
      mockReq.headers!.accept = 'text/html'
      mockReq.query!.format = 'json'

      // Mock oauth_states with helper
      const { select: oauthSelect } = makeSelectEqSingle({
        data: {
          id: 'state-id-123',
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })

      // Mock sessions with helper
      const { select: sessionSelect } = makeSelectEqSingle({
        data: { user_id: 'user-id-456' },
        error: null
      })

      // Mock users update with helper (needs .eq().eq() chain)
      const { chain: usersChain } = makeSelectEqSingle({ error: null })

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select: oauthSelect,
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        if (table === 'sessions') {
          return {
            select: sessionSelect
          }
        }
        if (table === 'user_accounts') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        if (table === 'users') {
          return {
            update: vi.fn(() => usersChain)
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody.success).toBe(true)
    })
  })

  describe('Account linking - Idempotent relink', () => {
    beforeEach(() => {
      vi.mocked(exchangeCodeForToken).mockResolvedValue({
        access_token: 'test_token_123',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identify'
      })

      vi.mocked(fetchDiscordUser).mockResolvedValue({
        id: '123456789',
        username: 'testuser',
        discriminator: '0',
        global_name: 'Test User',
        avatar: 'avatar_hash_123'
      })
    })

    it('returns success when account already linked to same user', async () => {
      const userId = 'user-id-456'

      // Mock oauth_states with helper
      const { select: oauthSelect } = makeSelectEqSingle({
        data: {
          id: 'state-id-123',
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })

      // Mock sessions with helper
      const { select: sessionSelect } = makeSelectEqSingle({
        data: { user_id: userId },
        error: null
      })

      // Mock existing user_accounts record (same user)
      const { select: userAccountSelect } = makeSelectEqSingle({
        data: { user_id: userId }, // Same user!
        error: null
      })

      // Mock users update with helper (needs .eq().eq() chain)
      const { chain: usersChain } = makeSelectEqSingle({ error: null })

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select: oauthSelect,
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        if (table === 'sessions') {
          return {
            select: sessionSelect
          }
        }
        if (table === 'user_accounts') {
          return {
            insert: vi.fn().mockResolvedValue({
              error: { code: '23505', message: 'duplicate key' } // Unique constraint violation
            }),
            select: userAccountSelect
          }
        }
        if (table === 'users') {
          return {
            update: vi.fn(() => usersChain)
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(200)
      expect(responseBody.success).toBe(true)
    })
  })

  describe('Account linking - Account in use', () => {
    beforeEach(() => {
      vi.mocked(exchangeCodeForToken).mockResolvedValue({
        access_token: 'test_token_123',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identify'
      })

      vi.mocked(fetchDiscordUser).mockResolvedValue({
        id: '123456789',
        username: 'testuser',
        discriminator: '0',
        global_name: 'Test User',
        avatar: 'avatar_hash_123'
      })
    })

    it('returns 409 when account linked to different user (JSON)', async () => {
      const currentUserId = 'user-id-456'
      const otherUserId = 'other-user-789'

      // Mock oauth_states with helper
      const { select: oauthSelect } = makeSelectEqSingle({
        data: {
          id: 'state-id-123',
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })

      // Mock sessions with helper
      const { select: sessionSelect } = makeSelectEqSingle({
        data: { user_id: currentUserId },
        error: null
      })

      // Mock existing user_accounts record (different user!)
      const { select: userAccountSelect } = makeSelectEqSingle({
        data: { user_id: otherUserId }, // Different user!
        error: null
      })

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select: oauthSelect,
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        if (table === 'sessions') {
          return {
            select: sessionSelect
          }
        }
        if (table === 'user_accounts') {
          return {
            insert: vi.fn().mockResolvedValue({
              error: { code: '23505', message: 'duplicate key' }
            }),
            select: userAccountSelect
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(409)
      expect(responseBody.error.code).toBe('ACCOUNT_IN_USE')
    })

    it('redirects with ACCOUNT_IN_USE error code (HTML)', async () => {
      mockReq.headers!.accept = 'text/html'

      // Mock Discord API calls (required for full flow)
      vi.mocked(exchangeCodeForToken).mockResolvedValue({
        access_token: 'test_token_123',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identify'
      })

      vi.mocked(fetchDiscordUser).mockResolvedValue({
        id: '123456789',
        username: 'testuser',
        discriminator: '0',
        global_name: 'Test User',
        avatar: 'avatar_hash_123'
      })

      const currentUserId = 'user-id-456'
      const otherUserId = 'other-user-789'

      // Mock oauth_states with helper
      const { select: oauthSelect } = makeSelectEqSingle({
        data: {
          id: 'state-id-123',
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })

      // Mock sessions with helper
      const { select: sessionSelect } = makeSelectEqSingle({
        data: { user_id: currentUserId },
        error: null
      })

      // Mock existing user_accounts record (different user!)
      const { select: userAccountSelect } = makeSelectEqSingle({
        data: { user_id: otherUserId },
        error: null
      })

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select: oauthSelect,
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        if (table === 'sessions') {
          return {
            select: sessionSelect
          }
        }
        if (table === 'user_accounts') {
          return {
            insert: vi.fn().mockResolvedValue({
              error: { code: '23505', message: 'duplicate key' }
            }),
            select: userAccountSelect
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('http://localhost:5173/?discord_error=ACCOUNT_IN_USE')
    })
  })

  describe('Error redirect mapping', () => {
    beforeEach(() => {
      mockReq.headers!.accept = 'text/html' // Redirect mode
    })

    it('maps INVALID_STATE to redirect error code', async () => {
      // State not found - use helper
      const { select } = makeSelectEqSingle({
        data: null,
        error: { code: 'PGRST116' }
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('http://localhost:5173/?discord_error=INVALID_STATE')
    })

    it('maps UPSTREAM_4XX to OAUTH_FAILED', async () => {
      // Mock oauth_states with helper
      const { select } = makeSelectEqSingle({
        data: {
          id: 'state-id-123',
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select,
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      const error = new Error('Invalid grant')
      ;(error as any).code = 'UPSTREAM_4XX'
      ;(error as any).httpStatus = 502
      vi.mocked(exchangeCodeForToken).mockRejectedValue(error)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('http://localhost:5173/?discord_error=OAUTH_FAILED')
    })

    it('maps UPSTREAM_5XX to OAUTH_UNAVAILABLE', async () => {
      // Mock oauth_states with helper
      const { select } = makeSelectEqSingle({
        data: {
          id: 'state-id-123',
          session_id: 'test-session-123',
          code_verifier: 'test-verifier',
          created_at: new Date().toISOString()
        },
        error: null
      })

      const mockFrom = vi.fn().mockImplementation((table) => {
        if (table === 'oauth_states') {
          return {
            select,
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        return {}
      })
      vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom as any)

      const error = new Error('Discord down')
      ;(error as any).code = 'UPSTREAM_5XX'
      ;(error as any).httpStatus = 503
      vi.mocked(exchangeCodeForToken).mockRejectedValue(error)

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('http://localhost:5173/?discord_error=OAUTH_UNAVAILABLE')
    })
  })

  describe('Method validation', () => {
    it('returns 405 for POST request', async () => {
      mockReq.method = 'POST'

      await handler(mockReq as VercelRequest, mockRes as VercelResponse)

      expect(statusCode).toBe(405)
    })
  })
})
