// tests/server/env-loader-alias.test.ts
// Tests for X402_PROVIDER_URL → X402_FACILITATOR_URL alias support

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('Environment Loader - X402 Provider URL Alias', () => {
  let originalEnv: NodeJS.ProcessEnv
  let consoleWarnSpy: any

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env }

    // Reset modules to force re-evaluation
    vi.resetModules()

    // Spy on console.warn
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    // Restore original env
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('should use X402_FACILITATOR_URL when set', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature'
    process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator'
    process.env.X402_PROVIDER_URL = undefined

    const { serverEnv } = await import('../../src/config/env.server')

    expect(serverEnv.X402_FACILITATOR_URL).toBe('https://x402.org/facilitator')
    expect(consoleWarnSpy).not.toHaveBeenCalled()
  })

  it('should use X402_PROVIDER_URL as fallback when X402_FACILITATOR_URL not set', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature'
    process.env.X402_FACILITATOR_URL = undefined
    process.env.X402_PROVIDER_URL = 'https://x402.org/facilitator'

    const { serverEnv } = await import('../../src/config/env.server')

    expect(serverEnv.X402_FACILITATOR_URL).toBe('https://x402.org/facilitator')
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('X402_PROVIDER_URL is deprecated')
    )
  })

  it('should prefer X402_FACILITATOR_URL when both are set', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature'
    process.env.X402_FACILITATOR_URL = 'https://facilitator.primary.com'
    process.env.X402_PROVIDER_URL = 'https://provider.legacy.com'

    const { serverEnv } = await import('../../src/config/env.server')

    expect(serverEnv.X402_FACILITATOR_URL).toBe('https://facilitator.primary.com')
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Both X402_PROVIDER_URL and X402_FACILITATOR_URL')
    )
  })

  it('should not warn when only X402_FACILITATOR_URL is set', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature'
    process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator'
    process.env.X402_PROVIDER_URL = undefined

    await import('../../src/config/env.server')

    expect(consoleWarnSpy).not.toHaveBeenCalled()
  })

  it('should handle neither URL being set', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature'
    process.env.X402_FACILITATOR_URL = undefined
    process.env.X402_PROVIDER_URL = undefined

    const { serverEnv } = await import('../../src/config/env.server')

    expect(serverEnv.X402_FACILITATOR_URL).toBeUndefined()
    expect(consoleWarnSpy).not.toHaveBeenCalled()
  })

  it('should handle both URLs being identical (no conflict warning)', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.signature'
    process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator'
    process.env.X402_PROVIDER_URL = 'https://x402.org/facilitator'

    const { serverEnv } = await import('../../src/config/env.server')

    expect(serverEnv.X402_FACILITATOR_URL).toBe('https://x402.org/facilitator')
    // Should not warn about conflict since URLs are the same
    const conflictWarnings = consoleWarnSpy.mock.calls.filter((call: any) =>
      call[0]?.includes('Both X402_PROVIDER_URL and X402_FACILITATOR_URL')
    )
    expect(conflictWarnings.length).toBe(0)
  })
})
