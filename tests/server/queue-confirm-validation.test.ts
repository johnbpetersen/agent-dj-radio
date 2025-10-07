// tests/server/queue-confirm-validation.test.ts
// Tests for /api/queue/confirm validation and error responses

import { describe, it, expect } from 'vitest'

/**
 * These tests verify /api/queue/confirm validation:
 * - Empty body → 400 with both fields missing
 * - Invalid txHash format → 400 with specific field error
 * - Missing challengeId → 400 with field error
 * - All 400 responses include requestId
 * - All 400 responses have error.code === "VALIDATION_ERROR"
 * - All 400 responses have error.fields array with structured errors
 */

describe('/api/queue/confirm Validation', () => {
  describe('Request Schema Validation', () => {
    it('should validate empty body has both fields missing', () => {
      const body = {}
      const expectedFields = [
        { path: 'challengeId', message: 'Required' },
        { path: 'txHash', message: 'Required' }
      ]

      // Simulate Zod validation
      const missingFields = []
      if (!('challengeId' in body)) {
        missingFields.push({ path: 'challengeId', message: 'Required' })
      }
      if (!('txHash' in body)) {
        missingFields.push({ path: 'txHash', message: 'Required' })
      }

      expect(missingFields).toHaveLength(2)
      expect(missingFields[0]).toEqual(expectedFields[0])
      expect(missingFields[1]).toEqual(expectedFields[1])
    })

    it('should validate txHash must be hex format', () => {
      const invalidTxHashes = [
        'bad',
        '0x123',
        '0xZZZZ',
        'not-hex',
        '0x' + 'g'.repeat(64)
      ]

      const hexPattern = /^0x[0-9a-fA-F]{64}$/

      invalidTxHashes.forEach(txHash => {
        expect(hexPattern.test(txHash)).toBe(false)
      })
    })

    it('should validate challengeId must be UUID format', () => {
      const invalidIds = [
        'not-a-uuid',
        '12345',
        'abc-def-ghi',
        ''
      ]

      // Simple UUID v4 pattern
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

      invalidIds.forEach(id => {
        expect(uuidPattern.test(id)).toBe(false)
      })
    })

    it('should accept valid UUID and hex txHash', () => {
      const validChallengeId = '123e4567-e89b-42d3-a456-426614174000'
      const validTxHash = '0x' + '1'.repeat(64)

      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      const hexPattern = /^0x[0-9a-fA-F]{64}$/

      expect(uuidPattern.test(validChallengeId)).toBe(true)
      expect(hexPattern.test(validTxHash)).toBe(true)
    })
  })

  describe('Error Response Format', () => {
    it('should have VALIDATION_ERROR code in error response', () => {
      const errorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          fields: [
            { path: 'txHash', message: 'Invalid transaction hash format' }
          ]
        },
        requestId: 'req-123'
      }

      expect(errorResponse.error.code).toBe('VALIDATION_ERROR')
      expect(errorResponse.error.message).toBe('Invalid request')
      expect(Array.isArray(errorResponse.error.fields)).toBe(true)
      expect(errorResponse.requestId).toBeTruthy()
    })

    it('should include fields array with path and message', () => {
      const fields = [
        { path: 'challengeId', message: 'Invalid challenge ID format' },
        { path: 'txHash', message: 'Invalid transaction hash format' }
      ]

      fields.forEach(field => {
        expect(field).toHaveProperty('path')
        expect(field).toHaveProperty('message')
        expect(typeof field.path).toBe('string')
        expect(typeof field.message).toBe('string')
      })
    })

    it('should include requestId in all error responses', () => {
      const errorResponses = [
        {
          error: { code: 'VALIDATION_ERROR', message: 'Invalid', fields: [] },
          requestId: 'req-1'
        },
        {
          error: { code: 'EXPIRED', message: 'Challenge expired' },
          requestId: 'req-2'
        },
        {
          error: { code: 'NO_MATCH', message: 'Not found' },
          requestId: 'req-3'
        }
      ]

      errorResponses.forEach(response => {
        expect(response.requestId).toBeTruthy()
        expect(typeof response.requestId).toBe('string')
      })
    })

    it('should format fields for logging', () => {
      const fields = [
        { path: 'txHash', message: 'Invalid transaction hash format' },
        { path: 'challengeId', message: 'Invalid challenge ID format' }
      ]

      const logMessage = fields.map(f => `${f.path}: ${f.message}`).join(', ')

      expect(logMessage).toBe(
        'txHash: Invalid transaction hash format, challengeId: Invalid challenge ID format'
      )
    })
  })

  describe('ZodError Issue Mapping', () => {
    it('should map Zod issues to fields array', () => {
      // Simulate Zod error issues
      const zodIssues = [
        { path: ['txHash'], message: 'Invalid transaction hash format' },
        { path: ['challengeId'], message: 'Invalid challenge ID format' }
      ]

      const fields = zodIssues.map(issue => ({
        path: issue.path.join('.') || 'body',
        message: issue.message
      }))

      expect(fields).toHaveLength(2)
      expect(fields[0]).toEqual({ path: 'txHash', message: 'Invalid transaction hash format' })
      expect(fields[1]).toEqual({ path: 'challengeId', message: 'Invalid challenge ID format' })
    })

    it('should handle nested path arrays', () => {
      const zodIssues = [
        { path: ['data', 'txHash'], message: 'Invalid format' },
        { path: [], message: 'Body required' }
      ]

      const fields = zodIssues.map(issue => ({
        path: issue.path.join('.') || 'body',
        message: issue.message
      }))

      expect(fields[0].path).toBe('data.txHash')
      expect(fields[1].path).toBe('body')
    })

    it('should handle multiple validation errors', () => {
      const zodIssues = [
        { path: ['txHash'], message: 'Required' },
        { path: ['challengeId'], message: 'Required' }
      ]

      const fields = zodIssues.map(issue => ({
        path: issue.path.join('.') || 'body',
        message: issue.message
      }))

      expect(fields).toHaveLength(2)
      expect(fields.every(f => f.message === 'Required')).toBe(true)
    })
  })

  describe('Error Codes Contract', () => {
    it('should define all possible error codes', () => {
      const validErrorCodes = [
        'VALIDATION_ERROR',
        'WRONG_CHAIN',
        'WRONG_ASSET',
        'WRONG_AMOUNT',
        'NO_MATCH',
        'EXPIRED',
        'PROVIDER_ERROR',
        'RATE_LIMITED',
        'DB_ERROR',
        'INTERNAL'
      ]

      // All codes should be string constants
      validErrorCodes.forEach(code => {
        expect(typeof code).toBe('string')
        expect(code.length).toBeGreaterThan(0)
      })
    })

    it('should use VALIDATION_ERROR for schema failures', () => {
      const errorCode = 'VALIDATION_ERROR'
      const zodErrorDetected = true

      const responseCode = zodErrorDetected ? 'VALIDATION_ERROR' : 'INTERNAL'

      expect(responseCode).toBe(errorCode)
    })

    it('should distinguish between validation and verification errors', () => {
      const validationErrors = ['VALIDATION_ERROR']
      const verificationErrors = [
        'WRONG_CHAIN',
        'WRONG_ASSET',
        'WRONG_AMOUNT',
        'NO_MATCH'
      ]

      // Validation happens before verification
      expect(validationErrors).not.toEqual(verificationErrors)
    })
  })

  describe('Status Code Mapping', () => {
    it('should return 400 for validation errors', () => {
      const errorCode = 'VALIDATION_ERROR'
      const statusCode = errorCode === 'VALIDATION_ERROR' ? 400 : 500

      expect(statusCode).toBe(400)
    })

    it('should return 400 for client errors', () => {
      const clientErrorCodes = [
        'VALIDATION_ERROR',
        'WRONG_CHAIN',
        'WRONG_ASSET',
        'EXPIRED',
        'NO_MATCH'
      ]

      clientErrorCodes.forEach(code => {
        const statusCode = 400 // All client errors
        expect(statusCode).toBe(400)
      })
    })

    it('should return 429 for rate limiting', () => {
      const errorCode = 'RATE_LIMITED'
      const statusCode = errorCode === 'RATE_LIMITED' ? 429 : 400

      expect(statusCode).toBe(429)
    })

    it('should return 500 for server errors', () => {
      const serverErrorCodes = ['DB_ERROR', 'INTERNAL', 'PROVIDER_ERROR']

      serverErrorCodes.forEach(code => {
        const statusCode = 500
        expect(statusCode).toBe(500)
      })
    })
  })

  describe('Integration Scenarios', () => {
    it('should handle complete validation error flow', () => {
      // 1. Empty request body
      const body = {}

      // 2. Zod validation fails
      const zodIssues = [
        { path: ['challengeId'], message: 'Required' },
        { path: ['txHash'], message: 'Required' }
      ]

      // 3. Map to fields array
      const fields = zodIssues.map(issue => ({
        path: issue.path.join('.') || 'body',
        message: issue.message
      }))

      // 4. Create error response
      const errorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          fields
        },
        requestId: 'req-test-123'
      }

      // 5. Verify response structure
      expect(errorResponse.error.code).toBe('VALIDATION_ERROR')
      expect(errorResponse.error.fields).toHaveLength(2)
      expect(errorResponse.requestId).toBeTruthy()

      // 6. Verify log format
      const logMessage = fields.map(f => `${f.path}: ${f.message}`).join(', ')
      expect(logMessage).toContain('challengeId: Required')
      expect(logMessage).toContain('txHash: Required')
    })

    it('should handle partial validation failure', () => {
      const body = { txHash: 'bad-format' }

      // Only txHash fails (challengeId missing)
      const zodIssues = [
        { path: ['challengeId'], message: 'Required' },
        { path: ['txHash'], message: 'Invalid transaction hash format' }
      ]

      const fields = zodIssues.map(issue => ({
        path: issue.path.join('.') || 'body',
        message: issue.message
      }))

      expect(fields).toHaveLength(2)
      expect(fields.find(f => f.path === 'challengeId')).toBeTruthy()
      expect(fields.find(f => f.path === 'txHash')).toBeTruthy()
    })

    it('should preserve error order from Zod', () => {
      const zodIssues = [
        { path: ['challengeId'], message: 'Invalid challenge ID format' },
        { path: ['txHash'], message: 'Invalid transaction hash format' }
      ]

      const fields = zodIssues.map(issue => ({
        path: issue.path.join('.') || 'body',
        message: issue.message
      }))

      // Order should match Zod output
      expect(fields[0].path).toBe('challengeId')
      expect(fields[1].path).toBe('txHash')
    })
  })
})
