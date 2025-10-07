// src/config/env.test.ts
// Minimal unit tests for environment validation

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('Environment validation', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    // Restore original env
    process.env = originalEnv
    // Clear module cache to allow re-importing with different env
    delete require.cache[require.resolve('./env.js')]
  })

  it('should fail cleanly with missing SUPABASE_URL (no TypeError)', () => {
    // Remove required env var
    delete process.env.SUPABASE_URL
    delete process.env.VITE_SUPABASE_URL

    // Should throw with clean error message, not TypeError about forEach
    expect(() => {
      // Dynamic import to trigger validation with current env
      require('./env.js')
    }).toThrow(/Server env validation failed/)
  })

  it('should pass with valid .env.local variables', () => {
    // Set all required vars
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature'
    process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature'
    process.env.STAGE = 'dev'

    // Should not throw
    expect(() => {
      require('./env.js')
    }).not.toThrow()
  })

  it('should report field names without values on validation failure', () => {
    // Intentionally break required var
    delete process.env.SUPABASE_ANON_KEY
    process.env.SUPABASE_URL = 'https://test.supabase.co'

    // Capture console output
    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: any[]) => {
      errors.push(args.join(' '))
    }

    try {
      require('./env.js')
    } catch (err) {
      // Expected to throw
    } finally {
      console.error = originalError
    }

    // Should mention the field name
    const errorOutput = errors.join('\n')
    expect(errorOutput).toContain('SUPABASE_ANON_KEY')
    // Should NOT contain actual secret values
    expect(errorOutput).not.toMatch(/eyJ[a-zA-Z0-9_-]+\./)
  })
})
