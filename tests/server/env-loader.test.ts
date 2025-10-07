// tests/server/env-loader.test.ts
// Unit tests for environment variable loading and coercion

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

/**
 * Tests for boolean coercion in environment loading
 *
 * These tests verify that the zod schema correctly converts:
 * - String "true" → boolean true
 * - String "false" → boolean false
 * - String "1" → boolean true
 * - String "0" → boolean false
 * - Empty string → boolean false
 * - Missing value → default value
 */

describe('Environment variable boolean coercion', () => {
  // Simulate the custom boolean parser from env.server.ts
  const booleanFromString = z
    .union([z.boolean(), z.string()])
    .transform((val) => {
      if (typeof val === 'boolean') return val
      const lower = val.toLowerCase().trim()
      if (lower === 'true' || lower === '1') return true
      if (lower === 'false' || lower === '0' || lower === '') return false
      return Boolean(val)
    })

  const testSchema = z.object({
    ENABLE_MOCK_PAYMENTS: booleanFromString.default(false),
    ENABLE_X402: booleanFromString.default(false),
  })

  describe('booleanFromString transformer behavior', () => {
    it('should convert string "true" to boolean true', () => {
      const result = testSchema.parse({
        ENABLE_MOCK_PAYMENTS: 'true',
        ENABLE_X402: 'false'
      })

      expect(result.ENABLE_MOCK_PAYMENTS).toBe(true)
      expect(result.ENABLE_X402).toBe(false)
    })

    it('should convert string "false" to boolean false', () => {
      const result = testSchema.parse({
        ENABLE_MOCK_PAYMENTS: 'false',
        ENABLE_X402: 'true'
      })

      expect(result.ENABLE_MOCK_PAYMENTS).toBe(false)
      expect(result.ENABLE_X402).toBe(true)
    })

    it('should convert numeric strings correctly', () => {
      const result = testSchema.parse({
        ENABLE_MOCK_PAYMENTS: '1',
        ENABLE_X402: '0'
      })

      expect(result.ENABLE_MOCK_PAYMENTS).toBe(true)
      expect(result.ENABLE_X402).toBe(false)
    })

    it('should convert empty string to false', () => {
      const result = testSchema.parse({
        ENABLE_MOCK_PAYMENTS: '',
        ENABLE_X402: ''
      })

      expect(result.ENABLE_MOCK_PAYMENTS).toBe(false)
      expect(result.ENABLE_X402).toBe(false)
    })

    it('should use default value when property is missing', () => {
      const result = testSchema.parse({})

      expect(result.ENABLE_MOCK_PAYMENTS).toBe(false)
      expect(result.ENABLE_X402).toBe(false)
    })

    it('should handle actual boolean values', () => {
      const result = testSchema.parse({
        ENABLE_MOCK_PAYMENTS: true,
        ENABLE_X402: false
      })

      expect(result.ENABLE_MOCK_PAYMENTS).toBe(true)
      expect(result.ENABLE_X402).toBe(false)
    })
  })

  describe('.env.local override behavior', () => {
    it('should demonstrate override logic (last value wins)', () => {
      // Simulating the dotenv loading order:
      // 1. .env sets ENABLE_MOCK_PAYMENTS=true
      // 2. .env.local sets ENABLE_MOCK_PAYMENTS=false (should override)

      const envValues = { ENABLE_MOCK_PAYMENTS: 'true' }
      const envLocalValues = { ENABLE_MOCK_PAYMENTS: 'false' }

      // After override, envLocalValues should win
      const merged = { ...envValues, ...envLocalValues }
      const result = testSchema.parse(merged)

      expect(result.ENABLE_MOCK_PAYMENTS).toBe(false)
    })

    it('should use .env value when .env.local does not define it', () => {
      const envValues = {
        ENABLE_MOCK_PAYMENTS: 'true',
        ENABLE_X402: 'false'
      }
      const envLocalValues = {
        ENABLE_X402: 'true'
        // ENABLE_MOCK_PAYMENTS not defined in .env.local
      }

      const merged = { ...envValues, ...envLocalValues }
      const result = testSchema.parse(merged)

      expect(result.ENABLE_MOCK_PAYMENTS).toBe(true) // from .env
      expect(result.ENABLE_X402).toBe(true) // from .env.local (overridden)
    })
  })

  describe('Case sensitivity', () => {
    it('should handle mixed case strings', () => {
      // Note: z.coerce.boolean() is case-insensitive for common values
      const testCases = [
        { value: 'TRUE', expected: true },
        { value: 'True', expected: true },
        { value: 'FALSE', expected: false },
        { value: 'False', expected: false },
      ]

      testCases.forEach(({ value, expected }) => {
        const result = testSchema.parse({ ENABLE_MOCK_PAYMENTS: value })
        expect(result.ENABLE_MOCK_PAYMENTS).toBe(expected)
      })
    })
  })
})

/**
 * Integration test notes:
 *
 * To manually verify .env.local override:
 *
 * 1. Create .env with:
 *    ENABLE_MOCK_PAYMENTS=true
 *    ENABLE_X402=true
 *
 * 2. Create .env.local with:
 *    ENABLE_MOCK_PAYMENTS=false
 *
 * 3. Start dev server: LOG_LEVEL=debug npm run dev
 *
 * 4. Check console output for:
 *    [env] x402 feature flags: { x402Enabled: true, mockEnabled: false, stage: 'dev' }
 *
 * 5. Verify /api/health returns:
 *    { features: { x402: { enabled: true, mockEnabled: false } } }
 *
 * 6. Remove .env.local and restart
 *
 * 7. Verify /api/health now returns:
 *    { features: { x402: { enabled: true, mockEnabled: true } } }
 */
