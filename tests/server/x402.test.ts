import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildChallenge, verifyPayment, generateMockPaymentProof, getSandboxConfig } from '../../src/server/x402'
import type { BuildChallengeParams, VerifyPaymentParams } from '../../src/server/x402'

// Mock dependencies
vi.mock('../../src/lib/logger')
vi.mock('../../src/lib/error-tracking')
vi.mock('../../src/server/x402-audit')
vi.mock('../../api/_shared/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        data: {},
        error: null
      })
    })
  }
}))

// Mock crypto.randomUUID
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: vi.fn(() => 'mock-uuid-123')
  },
  writable: true
})

// Mock fetch for verification tests
global.fetch = vi.fn()

describe('X402 Payment System', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('buildChallenge', () => {
    beforeEach(() => {
      // Mock environment variables
      process.env.X402_RECEIVING_ADDRESS = '0x1234567890abcdef'
      process.env.X402_ACCEPTED_ASSET = 'USDC'
      process.env.X402_CHAIN = 'base-sepolia'
    })

    it('should create valid payment challenge with USDC conversion', async () => {
      const params: BuildChallengeParams = {
        priceUsd: 4.27,
        trackId: 'track-123'
      }

      const result = await buildChallenge(params)

      expect(result.challenge).toHaveProperty('amount')
      expect(result.challenge).toHaveProperty('asset')
      expect(result.challenge).toHaveProperty('chain')
      expect(result.challenge).toHaveProperty('payTo')
      expect(result.challenge).toHaveProperty('nonce')
      expect(result.challenge).toHaveProperty('expiresAt')

      // Should convert USD to USDC with 6 decimals (4.27 * 10^6 = 4270000)
      expect(result.challenge.amount).toBe('4270000')
      expect(result.challenge.asset).toBe('USDC')
      expect(result.challenge.chain).toBe('base-sepolia')
      expect(result.challenge.nonce).toBe('mock-uuid-123')
      
      // Should expire in 15 minutes
      const expiryTime = new Date(result.challenge.expiresAt).getTime()
      const currentTime = Date.now()
      const timeDiff = expiryTime - currentTime
      expect(timeDiff).toBeGreaterThan(14 * 60 * 1000) // At least 14 minutes
      expect(timeDiff).toBeLessThan(16 * 60 * 1000) // At most 16 minutes
    })

    it('should handle integer prices correctly', async () => {
      const params: BuildChallengeParams = {
        priceUsd: 5,
        trackId: 'track-123'
      }

      const result = await buildChallenge(params)
      // 5.00 USD = 5000000 USDC wei (5 * 10^6)
      expect(result.challenge.amount).toBe('5000000')
    })

    it('should throw error when receiving address not configured', async () => {
      delete process.env.X402_RECEIVING_ADDRESS
      
      const params: BuildChallengeParams = {
        priceUsd: 5,
        trackId: 'track-123'
      }

      await expect(buildChallenge(params)).rejects.toThrow('x402 receiving address not configured')
    })
  })

  describe('verifyPayment', () => {
    const mockFetch = vi.mocked(fetch)

    beforeEach(() => {
      // Mock environment
      process.env.X402_PROVIDER_URL = 'https://api.cdp.coinbase.com/x402'
    })

    it('should accept valid payment proof from CDP', async () => {
      const challenge = {
        amount: '3000000', // 3 USDC in wei
        asset: 'USDC',
        chain: 'base-sepolia',
        payTo: '0x1234567890abcdef',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }

      // Mock successful CDP verification response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          verified: true,
          amount: '3000000',
          asset: 'USDC',
          chain: 'base-sepolia',
          transaction_hash: '0xabcdef123456789',
          block_number: 12345678
        })
      } as Response)

      const params: VerifyPaymentParams = {
        challenge,
        paymentProof: 'base64-encoded-proof-data',
        trackId: 'track-123'
      }

      const result = await verifyPayment(params)

      expect(result.verified).toBe(true)
      expect(result.proofData).toEqual({
        amount: '3000000',
        asset: 'USDC',
        chain: 'base-sepolia',
        transaction_hash: '0xabcdef123456789',
        block_number: 12345678,
        verified_at: expect.any(String),
        nonce: 'test-nonce',
        proof_type: 'cdp_sandbox',
        correlation_id: expect.any(String)
      })

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cdp.coinbase.com/x402/verify',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'User-Agent': 'Agent-DJ-Radio/1.0'
          }),
          body: expect.stringContaining('base64-encoded-proof-data'),
          signal: expect.any(AbortSignal)
        })
      )
    })

    it('should reject expired challenge', async () => {
      const challenge = {
        amount: '3000000',
        asset: 'USDC',
        chain: 'base-sepolia',
        payTo: '0x1234567890abcdef',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() - 1000).toISOString() // Expired 1 second ago
      }

      const params: VerifyPaymentParams = {
        challenge,
        paymentProof: 'base64-encoded-proof-data',
        trackId: 'track-123'
      }

      const result = await verifyPayment(params)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('expired')
      expect(mockFetch).not.toHaveBeenCalled() // Should not call CDP if expired
    })

    it('should retry on 429 rate limit errors', async () => {
      const challenge = {
        amount: '3000000',
        asset: 'USDC',
        chain: 'base-sepolia',
        payTo: '0x1234567890abcdef',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }

      // Mock rate limit error then success
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => 'Rate limit exceeded'
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            verified: true,
            transaction_hash: '0xretry123456789',
            block_number: 12345679
          })
        } as Response)

      const params: VerifyPaymentParams = {
        challenge,
        paymentProof: 'base64-encoded-proof-data',
        trackId: 'track-123'
      }

      const result = await verifyPayment(params)

      expect(result.verified).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(2) // Should retry once
    })

    it('should handle CDP verification failure', async () => {
      const challenge = {
        amount: '3000000',
        asset: 'USDC',
        chain: 'base-sepolia',
        payTo: '0x1234567890abcdef',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }

      // Mock CDP verification failure
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          verified: false,
          error: 'Invalid transaction signature'
        })
      } as Response)

      const params: VerifyPaymentParams = {
        challenge,
        paymentProof: 'invalid-proof-data',
        trackId: 'track-123'
      }

      const result = await verifyPayment(params)

      expect(result.verified).toBe(false)
      expect(result.error).toBe('Invalid transaction signature')
    })
  })

  describe('generateMockPaymentProof', () => {
    it('should generate valid mock payment proof', () => {
      const challenge = {
        amount: '3000000',
        asset: 'USDC',
        chain: 'base-sepolia',
        payTo: '0x1234567890abcdef',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }

      const proof = generateMockPaymentProof(challenge, true)
      
      // Should be base64 encoded
      expect(() => Buffer.from(proof, 'base64')).not.toThrow()
      
      // Decode and verify structure
      const decoded = JSON.parse(Buffer.from(proof, 'base64').toString())
      expect(decoded).toHaveProperty('transaction_hash')
      expect(decoded).toHaveProperty('amount', challenge.amount)
      expect(decoded).toHaveProperty('asset', challenge.asset)
      expect(decoded).toHaveProperty('chain', challenge.chain)
      expect(decoded).toHaveProperty('nonce', challenge.nonce)
      expect(decoded.transaction_hash).toMatch(/^0x[a-f0-9]{64}$/i)
    })

    it('should generate invalid proof when requested', () => {
      const challenge = {
        amount: '3000000',
        asset: 'USDC',
        chain: 'base-sepolia',
        payTo: '0x1234567890abcdef',
        nonce: 'test-nonce',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }

      const proof = generateMockPaymentProof(challenge, false)
      
      expect(proof).toMatch(/^invalid-proof-/)
    })
  })

  describe('getSandboxConfig', () => {
    it('should return current sandbox configuration', () => {
      process.env.X402_PROVIDER_URL = 'https://test.cdp.coinbase.com/x402'
      process.env.X402_ACCEPTED_ASSET = 'USDC'
      process.env.X402_CHAIN = 'base-sepolia'
      process.env.X402_RECEIVING_ADDRESS = '0xtest123'

      const config = getSandboxConfig()

      expect(config).toEqual({
        providerUrl: 'https://test.cdp.coinbase.com/x402',
        acceptedAsset: 'USDC',
        chain: 'base-sepolia',
        receivingAddress: '0xtest123',
        challengeExpirationMinutes: 15,
        usdcDecimals: 6,
        maxRetries: 3,
        rateLimitMs: 1000
      })
    })
  })
})