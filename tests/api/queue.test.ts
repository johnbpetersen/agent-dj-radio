import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { testUtils } from '../../src/test/mocks/handlers'

describe('Queue API Endpoints', () => {
  beforeEach(() => {
    testUtils.resetMockData()
  })
  
  afterEach(() => {
    testUtils.disableX402Mode() // Ensure clean state between tests
  })

  describe('POST /api/queue/price-quote', () => {
    it('should return correct prices for valid durations', async () => {
      const testCases = [
        { duration: 60, expectedPrice: 3.00 },
        { duration: 90, expectedPrice: 4.27 },
        { duration: 120, expectedPrice: 5.40 }
      ]

      for (const { duration, expectedPrice } of testCases) {
        const response = await fetch('/api/queue/price-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration_seconds: duration })
        })

        expect(response.status).toBe(200)
        
        const result = await response.json()
        expect(result.price_usd).toBe(expectedPrice)
        expect(result.duration_seconds).toBe(duration)
      }
    })

    it('should reject invalid durations', async () => {
      const invalidDurations = [30, 75, 150, 0, -60]

      for (const duration of invalidDurations) {
        const response = await fetch('/api/queue/price-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration_seconds: duration })
        })

        expect(response.status).toBe(400)
        
        const result = await response.json()
        expect(result.error).toContain('Invalid duration')
      }
    })

    it('should reject missing duration', async () => {
      const response = await fetch('/api/queue/price-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      expect(response.status).toBe(400)
    })

    it('should only accept POST method', async () => {
      const response = await fetch('/api/queue/price-quote', {
        method: 'GET'
      })

      expect(response.status).toBe(405)
    })
  })

  describe('POST /api/queue/submit', () => {
    it('should create track successfully with valid input in Sprint 1 mode', async () => {
      // Explicitly ensure Sprint 1 mode (should be default)
      testUtils.disableX402Mode()
      const trackData = {
        prompt: 'A happy upbeat song',
        duration_seconds: 120,
        user_id: 'user-123'
      }

      const response = await fetch('/api/queue/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trackData)
      })

      expect(response.status).toBe(201)
      
      const result = await response.json()
      expect(result.track).toHaveProperty('id')
      expect(result.track.prompt).toBe(trackData.prompt)
      expect(result.track.duration_seconds).toBe(trackData.duration_seconds)
      expect(result.track.user_id).toBe(trackData.user_id)
      expect(result.track.status).toBe('PAID')
      expect(result.track.price_usd).toBe(5.40) // 120s price
    })

    it('should validate required fields', async () => {
      const testCases = [
        { prompt: '', duration_seconds: 120, user_id: 'user-1' }, // empty prompt
        { duration_seconds: 120, user_id: 'user-1' }, // missing prompt
        { prompt: 'test', user_id: 'user-1' }, // missing duration
        { prompt: 'test', duration_seconds: 120 }, // missing user_id
      ]

      for (const data of testCases) {
        const response = await fetch('/api/queue/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })

        expect(response.status).toBe(400)
      }
    })

    it('should validate duration', async () => {
      const response = await fetch('/api/queue/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'test track',
          duration_seconds: 75, // invalid
          user_id: 'user-1'
        })
      })

      expect(response.status).toBe(400)
      
      const result = await response.json()
      expect(result.error).toContain('Invalid duration')
    })

    it('should trim prompt whitespace', async () => {
      const response = await fetch('/api/queue/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '  spaced prompt  ',
          duration_seconds: 120,
          user_id: 'user-1'
        })
      })

      expect(response.status).toBe(201)
      
      const result = await response.json()
      expect(result.track.prompt).toBe('spaced prompt')
    })

    it('should only accept POST method', async () => {
      const response = await fetch('/api/queue/submit', {
        method: 'GET'
      })

      expect(response.status).toBe(405)
    })

    it('should return 402 challenge in x402 mode', async () => {
      // Enable x402 mode
      testUtils.enableX402Mode()
      
      const trackData = {
        prompt: 'Test x402 track',
        duration_seconds: 60,
        user_id: 'user-123'
      }

      const response = await fetch('/api/queue/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trackData)
      })

      expect(response.status).toBe(402)
      
      const result = await response.json()
      expect(result).toHaveProperty('challenge')
      expect(result).toHaveProperty('track_id')
      expect(result.challenge).toHaveProperty('amount')
      expect(result.challenge).toHaveProperty('asset')
      expect(result.challenge).toHaveProperty('nonce')
      expect(result.challenge).toHaveProperty('expiresAt')
      expect(result.challenge.amount).toBe('3.00') // 60s price
    })
  })

  describe('POST /api/queue/confirm (x402 Flow)', () => {
    it('should confirm payment with valid proof in x402 mode', async () => {
      // Enable x402 mode for this test
      testUtils.enableX402Mode()
      // First submit a track to get pending payment
      const submitResponse = await fetch('/api/queue/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test track',
          duration_seconds: 60,
          user_id: 'user-123'
        })
      })

      // In x402 mode, expect 402 with challenge
      if (submitResponse.status === 402) {
        const submitResult = await submitResponse.json()
        expect(submitResult).toHaveProperty('challenge')
        expect(submitResult).toHaveProperty('track_id')

        // Now confirm payment
        const confirmResponse = await fetch('/api/queue/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            track_id: submitResult.track_id,
            payment_proof: {
              txid: 'test_tx_123',
              amount: submitResult.challenge.amount
            }
          })
        })

        expect(confirmResponse.status).toBe(200)
        
        const confirmResult = await confirmResponse.json()
        expect(confirmResult.track.status).toBe('PAID')
        expect(confirmResult.payment_verified).toBe(true)
      } else {
        // In mock mode, should get 201 directly
        expect(submitResponse.status).toBe(201)
        const result = await submitResponse.json()
        expect(result.track.status).toBe('PAID')
      }
    })

    it('should reject confirmation without payment proof', async () => {
      const response = await fetch('/api/queue/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_id: 'track-123'
          // missing payment_proof
        })
      })

      expect(response.status).toBe(400)
      
      const result = await response.json()
      expect(result.error).toContain('Payment proof is required')
    })

    it('should reject confirmation for non-existent track', async () => {
      const response = await fetch('/api/queue/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_id: 'non-existent',
          payment_proof: { txid: 'test' }
        })
      })

      expect(response.status).toBe(404)
      
      const result = await response.json()
      expect(result.error).toContain('Track not found')
    })

    it('should be idempotent for already paid tracks', async () => {
      // Add a test track that's already PAID
      const paidTrack = testUtils.addMockTrack({
        id: 'paid-track-1',
        status: 'PAID',
        prompt: 'Already paid track',
        duration_seconds: 60,
        price_usd: 3.00
      })
      
      const response = await fetch('/api/queue/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_id: paidTrack.id,
          payment_proof: { txid: 'test' }
        })
      })

      expect(response.status).toBe(200)
      
      const result = await response.json()
      expect(result.track.status).toBe('PAID')
      expect(result.payment_verified).toBe(true)
    })

    it('should only accept POST method', async () => {
      const response = await fetch('/api/queue/confirm', {
        method: 'GET'
      })

      expect(response.status).toBe(405)
    })
  })
})