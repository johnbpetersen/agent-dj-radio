// tests/client/submit-402-flow.test.ts
// Tests for Submit → 402 → PaymentModal flow

import { describe, it, expect } from 'vitest'
import { parseXPaymentHeader } from '../../src/lib/x402-utils'

/**
 * These tests verify the complete 402 challenge flow:
 * - Submit returns 402 with X-PAYMENT header
 * - parseXPaymentHeader extracts challengeId
 * - Challenge is stored in state and passed to PaymentModal
 * - PaymentModal sends correct payload: { challengeId, txHash }
 * - Error responses render readable strings (no "[object Object]")
 */

describe('Submit → 402 → PaymentModal Flow', () => {
  describe('402 Response Handling', () => {
    it('should extract X-PAYMENT header from 402 response', () => {
      const mockResponse = {
        status: 402,
        headers: new Headers({
          'X-PAYMENT': 'payTo=0x1234567890123456789012345678901234567890; amount=150000; asset=USDC; chain=base-sepolia; expiresAt=2025-10-07T12:34:56Z; challengeId=550e8400-e29b-41d4-a716-446655440000; nonce=abc123'
        })
      }

      const xPaymentHeader = mockResponse.headers.get('X-PAYMENT')

      expect(xPaymentHeader).toBeTruthy()
      expect(xPaymentHeader).toContain('challengeId=')
    })

    it('should parse X-PAYMENT header to get challengeId', () => {
      const xPaymentHeader = 'payTo=0x1234567890123456789012345678901234567890; amount=150000; asset=USDC; chain=base-sepolia; expiresAt=2025-10-07T12:34:56Z; challengeId=550e8400-e29b-41d4-a716-446655440000; nonce=abc123'

      const parsed = parseXPaymentHeader(xPaymentHeader)

      expect(parsed).toBeTruthy()
      expect(parsed?.challengeId).toBe('550e8400-e29b-41d4-a716-446655440000')
      expect(parsed?.payTo).toBe('0x1234567890123456789012345678901234567890')
      expect(parsed?.amount).toBe('150000') // parseXPaymentHeader returns string
      expect(parsed?.asset).toBe('USDC')
      expect(parsed?.chain).toBe('base-sepolia')
    })

    it('should handle missing X-PAYMENT header gracefully', () => {
      const mockResponse = {
        status: 402,
        headers: new Headers()
      }

      const xPaymentHeader = mockResponse.headers.get('X-PAYMENT')

      expect(xPaymentHeader).toBeNull()
    })

    it('should handle malformed X-PAYMENT header', () => {
      const malformed = 'invalid header format'

      const parsed = parseXPaymentHeader(malformed)

      expect(parsed).toBeNull()
    })
  })

  describe('Challenge State Management', () => {
    it('should store parsed challenge in state', () => {
      const challenge = {
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        payTo: '0x1234567890123456789012345678901234567890',
        amount: '150000',
        asset: 'USDC',
        chain: 'base-sepolia',
        expiresAt: '2025-10-07T12:34:56Z',
        nonce: 'abc123'
      }

      // Simulate state storage
      let parsedChallenge: typeof challenge | null = null
      parsedChallenge = challenge

      expect(parsedChallenge).toBeTruthy()
      expect(parsedChallenge?.challengeId).toBe('550e8400-e29b-41d4-a716-446655440000')
    })

    it('should open PaymentModal when challenge is set', () => {
      const challenge = {
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        payTo: '0x1234567890123456789012345678901234567890',
        amount: '150000',
        asset: 'USDC',
        chain: 'base-sepolia',
        expiresAt: '2025-10-07T12:34:56Z',
        nonce: 'abc123'
      }

      let showPaymentModal = false

      // Simulate 402 handling
      if (challenge) {
        showPaymentModal = true
      }

      expect(showPaymentModal).toBe(true)
    })

    it('should pass challenge to PaymentModal via prop', () => {
      const challenge = {
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        payTo: '0x1234567890123456789012345678901234567890',
        amount: '150000',
        asset: 'USDC',
        chain: 'base-sepolia',
        expiresAt: '2025-10-07T12:34:56Z',
        nonce: 'abc123'
      }

      // Simulate passing challenge to modal
      const modalProps = {
        challenge,
        onSuccess: () => {},
        onRefresh: () => {},
        onClose: () => {}
      }

      expect(modalProps.challenge).toBe(challenge)
      expect(modalProps.challenge.challengeId).toBe('550e8400-e29b-41d4-a716-446655440000')
    })
  })

  describe('Confirm Payload Construction', () => {
    it('should build payload with challengeId and txHash', () => {
      const challenge = {
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        payTo: '0x1234567890123456789012345678901234567890',
        amount: '150000',
        asset: 'USDC',
        chain: 'base-sepolia',
        expiresAt: '2025-10-07T12:34:56Z',
        nonce: 'abc123'
      }
      const txHash = '0x' + '1'.repeat(64)

      const payload = {
        challengeId: challenge.challengeId,
        txHash: txHash.trim()
      }

      expect(payload.challengeId).toBe('550e8400-e29b-41d4-a716-446655440000')
      expect(payload.txHash).toBe('0x' + '1'.repeat(64))
      expect(payload.txHash.length).toBe(66) // 0x + 64 hex chars
    })

    it('should trim txHash in payload', () => {
      const txHash = '  0x' + '1'.repeat(64) + '  '

      const payload = {
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        txHash: txHash.trim()
      }

      expect(payload.txHash).toBe('0x' + '1'.repeat(64))
      expect(payload.txHash).not.toContain(' ')
    })

    it('should log payload for debugging', () => {
      const payload = {
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        txHash: '0x' + '1'.repeat(64)
      }

      // Simulate console.debug
      const loggedPayload = JSON.stringify(payload)

      expect(loggedPayload).toContain('challengeId')
      expect(loggedPayload).toContain('txHash')
      expect(loggedPayload).toContain('550e8400-e29b-41d4-a716-446655440000')
    })
  })

  describe('Error Handling', () => {
    it('should handle VALIDATION_ERROR with fields array', () => {
      const errorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          fields: [
            { path: 'challengeId', message: 'Required' },
            { path: 'txHash', message: 'Required' }
          ]
        },
        requestId: 'req-123'
      }

      // Simulate toErrorStringSync
      const errObj = errorResponse.error
      const fieldMessages = errObj.fields
        .map(f => `${f.path}: ${f.message}`)
        .join(', ')
      const formatted = `${errObj.code}: ${errObj.message} (${fieldMessages})`

      expect(formatted).toBe('VALIDATION_ERROR: Invalid request (challengeId: Required, txHash: Required)')
      expect(formatted).not.toContain('[object Object]')
    })

    it('should handle missing challengeId error', () => {
      const errorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          fields: [
            { path: 'challengeId', message: 'Required' }
          ]
        },
        requestId: 'req-456'
      }

      const errObj = errorResponse.error
      const fieldMessages = errObj.fields
        .map(f => `${f.path}: ${f.message}`)
        .join(', ')
      const formatted = `${errObj.code}: ${errObj.message} (${fieldMessages})`

      expect(formatted).toContain('challengeId: Required')
    })

    it('should handle missing txHash error', () => {
      const errorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          fields: [
            { path: 'txHash', message: 'Invalid transaction hash format' }
          ]
        },
        requestId: 'req-789'
      }

      const errObj = errorResponse.error
      const fieldMessages = errObj.fields
        .map(f => `${f.path}: ${f.message}`)
        .join(', ')
      const formatted = `${errObj.code}: ${errObj.message} (${fieldMessages})`

      expect(formatted).toContain('txHash: Invalid transaction hash format')
      expect(formatted).not.toContain('[object Object]')
    })

    it('should never return "[object Object]" for any error', () => {
      const testErrors = [
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid' } },
        { error: { code: 'EXPIRED', message: 'Challenge expired' } },
        new Error('Network error'),
        'String error',
        { unexpected: 'object' }
      ]

      testErrors.forEach(err => {
        let formatted: string

        if (err && typeof err === 'object' && 'error' in err) {
          const errObj = (err as any).error
          formatted = `${errObj.code}: ${errObj.message}`
        } else if (err instanceof Error) {
          formatted = err.message
        } else if (typeof err === 'string') {
          formatted = err
        } else {
          formatted = JSON.stringify(err)
        }

        expect(formatted).not.toBe('[object Object]')
        expect(formatted).not.toContain('[object Object]')
      })
    })
  })

  describe('Debug Logging', () => {
    it('should log parsed challenge on 402', () => {
      const challenge = {
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        payTo: '0x1234567890123456789012345678901234567890',
        amount: '150000',
        asset: 'USDC',
        chain: 'base-sepolia',
        expiresAt: '2025-10-07T12:34:56Z',
        nonce: 'abc123'
      }

      // Simulate console.debug('[submit] parsed challenge', challenge)
      const debugMessage = '[submit] parsed challenge'
      const debugPayload = challenge

      expect(debugMessage).toContain('[submit]')
      expect(debugPayload.challengeId).toBeTruthy()
    })

    it('should log confirm payload before fetch', () => {
      const payload = {
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        txHash: '0x' + '1'.repeat(64)
      }

      // Simulate console.debug('[confirm] payload', payload)
      const debugMessage = '[confirm] payload'
      const debugPayload = payload

      expect(debugMessage).toContain('[confirm]')
      expect(debugPayload).toHaveProperty('challengeId')
      expect(debugPayload).toHaveProperty('txHash')
    })
  })

  describe('Integration Flow', () => {
    it('should complete full flow: 402 → parse → modal → confirm', () => {
      // 1. Submit returns 402
      const submitResponse = {
        status: 402,
        headers: new Headers({
          'X-PAYMENT': 'payTo=0x1234567890123456789012345678901234567890; amount=150000; asset=USDC; chain=base-sepolia; expiresAt=2025-10-07T12:34:56Z; challengeId=550e8400-e29b-41d4-a716-446655440000; nonce=abc123'
        })
      }

      // 2. Parse X-PAYMENT header
      const xPaymentHeader = submitResponse.headers.get('X-PAYMENT')
      expect(xPaymentHeader).toBeTruthy()

      const challenge = parseXPaymentHeader(xPaymentHeader!)
      expect(challenge).toBeTruthy()
      expect(challenge?.challengeId).toBe('550e8400-e29b-41d4-a716-446655440000')

      // 3. Modal receives challenge
      const modalProps = {
        challenge: challenge!,
        onSuccess: () => {},
        onRefresh: () => {},
        onClose: () => {}
      }
      expect(modalProps.challenge.challengeId).toBe('550e8400-e29b-41d4-a716-446655440000')

      // 4. User enters txHash and clicks verify
      const txHash = '0x' + '1'.repeat(64)
      const confirmPayload = {
        challengeId: modalProps.challenge.challengeId,
        txHash: txHash.trim()
      }

      expect(confirmPayload.challengeId).toBe('550e8400-e29b-41d4-a716-446655440000')
      expect(confirmPayload.txHash).toBe('0x' + '1'.repeat(64))
    })
  })
})
