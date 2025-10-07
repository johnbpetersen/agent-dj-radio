// scripts/doctor.test.ts
// Unit tests for doctor CLI helper functions

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { checkNodeVersion, checkEnvVars, checkSupabaseDNS } from './doctor.js'

describe('Doctor CLI', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('checkNodeVersion', () => {
    it('should pass for Node 20.x', async () => {
      const result = await checkNodeVersion()
      // Assuming test runs on Node 20-22
      expect(result.status).toMatch(/PASS|WARN/)
      expect(result.name).toBe('Node.js version')
    })
  })

  describe('checkEnvVars', () => {
    it('should fail when required vars are missing', async () => {
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_ANON_KEY
      delete process.env.VITE_SUPABASE_URL
      delete process.env.VITE_SUPABASE_ANON_KEY

      const result = await checkEnvVars()

      expect(result.status).toBe('FAIL')
      expect(result.message).toContain('missing')
    })

    it('should pass when all required dev vars are present', async () => {
      process.env.STAGE = 'dev'
      process.env.SUPABASE_URL = 'https://test.supabase.co'
      process.env.SUPABASE_ANON_KEY = 'test-key'
      process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
      process.env.VITE_SUPABASE_ANON_KEY = 'test-key'

      const result = await checkEnvVars()

      expect(result.status).toBe('PASS')
      expect(result.message).toContain('4/4')
    })

    it('should require additional vars for alpha stage', async () => {
      process.env.STAGE = 'alpha'
      process.env.SUPABASE_URL = 'https://test.supabase.co'
      process.env.SUPABASE_ANON_KEY = 'test-key'
      process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
      process.env.VITE_SUPABASE_ANON_KEY = 'test-key'
      // Missing X402 and ELEVEN vars
      delete process.env.X402_PROVIDER_URL
      delete process.env.X402_API_KEY
      delete process.env.X402_RECEIVING_ADDRESS
      delete process.env.ELEVEN_API_KEY

      const result = await checkEnvVars()

      expect(result.status).toBe('FAIL')
      expect(result.message).toContain('X402')
      expect(result.message).toContain('ELEVEN')
    })
  })

  describe('checkSupabaseDNS', () => {
    it('should skip if SUPABASE_URL not set', async () => {
      delete process.env.SUPABASE_URL

      const result = await checkSupabaseDNS()

      expect(result.status).toBe('SKIP')
      expect(result.message).toContain('not set')
    })

    it('should pass for valid public hostname', async () => {
      process.env.SUPABASE_URL = 'https://supabase.com'

      const result = await checkSupabaseDNS()

      expect(result.status).toBe('PASS')
      expect(result.message).toBe('supabase.com')
    })

    it('should fail for invalid hostname', async () => {
      process.env.SUPABASE_URL = 'https://this-does-not-exist-12345678.invalid'

      const result = await checkSupabaseDNS()

      expect(result.status).toBe('FAIL')
      expect(result.message).toContain('DNS lookup failed')
    })
  })
})
