import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildChallenge, verifyPayment } from '../../src/server/x402'
import type { BuildChallengeParams, VerifyPaymentParams } from '../../src/types'

// Mock crypto.randomUUID
global.crypto = {
  randomUUID: vi.fn(() => 'mock-uuid-123')
} as any

describe('X402 Payment System', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('buildChallenge', () => {
    it('should create valid payment challenge', () => {
      const params: BuildChallengeParams = {
        priceUsd: 4.27,
        trackId: 'track-123'
      }

      const result = buildChallenge(params)

      expect(result.challenge).toHaveProperty('amount')
      expect(result.challenge).toHaveProperty('asset')
      expect(result.challenge).toHaveProperty('chain')
      expect(result.challenge).toHaveProperty('payTo')
      expect(result.challenge).toHaveProperty('nonce')
      expect(result.challenge).toHaveProperty('expiresAt')

      expect(result.challenge.amount).toBe('4.27')
      expect(result.challenge.asset).toBe('USD')
      expect(result.challenge.nonce).toBe('mock-uuid-123')
      
      // Should expire in 15 minutes
      const expiryTime = new Date(result.challenge.expiresAt).getTime()
      const currentTime = Date.now()
      const timeDiff = expiryTime - currentTime
      expect(timeDiff).toBeGreaterThan(14 * 60 * 1000) // At least 14 minutes
      expect(timeDiff).toBeLessThan(16 * 60 * 1000) // At most 16 minutes
    })

    it('should format price correctly', () => {
      const params: BuildChallengeParams = {
        priceUsd: 5,
        trackId: 'track-123'
      }

      const result = buildChallenge(params)
      expect(result.challenge.amount).toBe('5.00')
    })
  })

  describe('verifyPayment', () => {
    it('should accept valid payment proof', async () => {
      const challenge = {
        amount: '3.00',
        asset: 'USD',
        chain: 'test',
        payTo: 'test-address',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }

      const params: VerifyPaymentParams = {
        challenge,
        paymentProof: {
          txid: 'test-tx-123',
          amount: '3.00'
        },
        trackId: 'track-123'
      }

      const result = await verifyPayment(params)

      expect(result.verified).toBe(true)
      expect(result.proofData).toEqual({
        txid: 'test-tx-123',
        amount: '3.00',
        verified_at: expect.any(String)
      })
    })

    it('should reject expired challenge', async () => {
      const challenge = {
        amount: '3.00',
        asset: 'USD',
        chain: 'test',
        payTo: 'test-address',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() - 1000).toISOString() // Expired 1 second ago
      }

      const params: VerifyPaymentParams = {
        challenge,
        paymentProof: {
          txid: 'test-tx-123',
          amount: '3.00'
        },
        trackId: 'track-123'
      }

      const result = await verifyPayment(params)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('expired')
    })

    it('should reject incorrect amount', async () => {
      const challenge = {
        amount: '3.00',
        asset: 'USD',
        chain: 'test',
        payTo: 'test-address',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }

      const params: VerifyPaymentParams = {
        challenge,
        paymentProof: {
          txid: 'test-tx-123',
          amount: '2.50' // Wrong amount
        },
        trackId: 'track-123'
      }

      const result = await verifyPayment(params)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('amount')
    })

    it('should reject missing transaction ID', async () => {
      const challenge = {
        amount: '3.00',
        asset: 'USD',
        chain: 'test',
        payTo: 'test-address',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }

      const params: VerifyPaymentParams = {
        challenge,
        paymentProof: {
          amount: '3.00'
          // Missing txid
        } as any,
        trackId: 'track-123'
      }

      const result = await verifyPayment(params)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('transaction')
    })
  })
})