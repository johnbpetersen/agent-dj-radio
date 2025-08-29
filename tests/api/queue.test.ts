import { describe, it, expect, beforeEach } from 'vitest'
import { testUtils } from '../../src/test/mocks/handlers'

describe('Queue API Endpoints', () => {
  beforeEach(() => {
    testUtils.resetMockData()
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
    it('should create track successfully with valid input', async () => {
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
  })
})