// tests/server/health-x402-mode.test.ts
// Tests for health endpoint x402 mode reporting

import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('Health Endpoint - X402 Mode Reporting', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('should report facilitator mode when X402_MODE=facilitator', async () => {
    // Mock environment for facilitator mode
    vi.doMock('../../src/config/env.server.js', () => ({
      serverEnv: {
        STAGE: 'dev',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature',
        ENABLE_X402: true,
        ENABLE_MOCK_PAYMENTS: false,
        X402_MODE: 'facilitator',
        X402_FACILITATOR_URL: 'https://x402.org/facilitator',
        X402_CHAIN: 'base-sepolia',
        X402_ACCEPTED_ASSET: 'USDC',
        X402_RECEIVING_ADDRESS: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6'
      }
    }))

    // Mock Supabase client
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        from: () => ({
          select: () => ({
            limit: () => ({
              abortSignal: vi.fn().mockResolvedValue({ data: [], error: null })
            })
          })
        })
      }))
    }))

    const healthModule = await import('../../api/health')
    const healthHandler = healthModule.default

    // Mock request/response
    const req = { method: 'GET' } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn()
    } as any

    await healthHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const response = res.json.mock.calls[0][0]

    expect(response.features.x402).toEqual({
      enabled: true,
      mockEnabled: false,
      mode: 'facilitator',
      facilitatorUrl: 'https://x402.org/facilitator',
      hasCDPKeys: false
    })
  })

  it('should report cdp mode when X402_MODE=cdp', async () => {
    vi.doMock('../../src/config/env.server.js', () => ({
      serverEnv: {
        STAGE: 'dev',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature',
        ENABLE_X402: true,
        ENABLE_MOCK_PAYMENTS: false,
        X402_MODE: 'cdp',
        X402_PROVIDER_URL: 'https://api.cdp.coinbase.com',
        CDP_API_KEY_ID: 'test-key-id',
        CDP_API_KEY_SECRET: 'test-key-secret',
        X402_CHAIN: 'base-sepolia',
        X402_ACCEPTED_ASSET: 'USDC',
        X402_RECEIVING_ADDRESS: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6'
      }
    }))

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        from: () => ({
          select: () => ({
            limit: () => ({
              abortSignal: vi.fn().mockResolvedValue({ data: [], error: null })
            })
          })
        })
      }))
    }))

    const healthModule = await import('../../api/health')
    const healthHandler = healthModule.default

    const req = { method: 'GET' } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn()
    } as any

    await healthHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const response = res.json.mock.calls[0][0]

    expect(response.features.x402).toEqual({
      enabled: true,
      mockEnabled: false,
      mode: 'cdp',
      facilitatorUrl: null,
      hasCDPKeys: true
    })
  })

  it('should report mock mode when ENABLE_MOCK_PAYMENTS=true', async () => {
    vi.doMock('../../src/config/env.server.js', () => ({
      serverEnv: {
        STAGE: 'dev',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature',
        ENABLE_X402: false,
        ENABLE_MOCK_PAYMENTS: true,
        X402_MODE: 'none',
        X402_CHAIN: 'base-sepolia',
        X402_ACCEPTED_ASSET: 'USDC'
      }
    }))

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        from: () => ({
          select: () => ({
            limit: () => ({
              abortSignal: vi.fn().mockResolvedValue({ data: [], error: null })
            })
          })
        })
      }))
    }))

    const healthModule = await import('../../api/health')
    const healthHandler = healthModule.default

    const req = { method: 'GET' } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn()
    } as any

    await healthHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const response = res.json.mock.calls[0][0]

    expect(response.features.x402).toEqual({
      enabled: false,
      mockEnabled: true,
      mode: 'mock',
      facilitatorUrl: null,
      hasCDPKeys: false
    })
  })

  it('should report none mode when no payment methods enabled', async () => {
    vi.doMock('../../src/config/env.server.js', () => ({
      serverEnv: {
        STAGE: 'dev',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature',
        ENABLE_X402: false,
        ENABLE_MOCK_PAYMENTS: false,
        X402_MODE: 'none',
        X402_CHAIN: 'base-sepolia',
        X402_ACCEPTED_ASSET: 'USDC'
      }
    }))

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        from: () => ({
          select: () => ({
            limit: () => ({
              abortSignal: vi.fn().mockResolvedValue({ data: [], error: null })
            })
          })
        })
      }))
    }))

    const healthModule = await import('../../api/health')
    const healthHandler = healthModule.default

    const req = { method: 'GET' } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn()
    } as any

    await healthHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const response = res.json.mock.calls[0][0]

    expect(response.features.x402).toEqual({
      enabled: false,
      mockEnabled: false,
      mode: 'none',
      facilitatorUrl: null,
      hasCDPKeys: false
    })
  })

  it('should fallback to none when facilitator mode but missing URL', async () => {
    vi.doMock('../../src/config/env.server.js', () => ({
      serverEnv: {
        STAGE: 'dev',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature',
        ENABLE_X402: true,
        ENABLE_MOCK_PAYMENTS: false,
        X402_MODE: 'facilitator',
        // X402_FACILITATOR_URL missing
        X402_CHAIN: 'base-sepolia',
        X402_ACCEPTED_ASSET: 'USDC',
        X402_RECEIVING_ADDRESS: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6'
      }
    }))

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        from: () => ({
          select: () => ({
            limit: () => ({
              abortSignal: vi.fn().mockResolvedValue({ data: [], error: null })
            })
          })
        })
      }))
    }))

    const healthModule = await import('../../api/health')
    const healthHandler = healthModule.default

    const req = { method: 'GET' } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn()
    } as any

    await healthHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const response = res.json.mock.calls[0][0]

    // Should fallback to 'none' since facilitatorUrl is required but missing
    expect(response.features.x402.mode).toBe('none')
    expect(response.features.x402.enabled).toBe(true)
    expect(response.features.x402.facilitatorUrl).toBe(null)
  })
})
