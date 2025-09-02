import { describe, it, expect, beforeEach, vi } from 'vitest'
import { checkSubmitCooldown, recordSubmit } from '../../src/server/rate-limit'

describe('Rate Limiting', () => {
  beforeEach(() => {
    // Clear any existing rate limit data
    vi.clearAllMocks()
  })

  describe('checkSubmitCooldown', () => {
    it('should allow first submit for new user', () => {
      const result = checkSubmitCooldown({ userId: 'new-user-123' })

      expect(result.allowed).toBe(true)
      expect(result.remainingSeconds).toBe(0)
    })

    it('should block submit within cooldown period', () => {
      const userId = 'test-user-123'
      
      // Record a submit
      recordSubmit({ userId })
      
      // Check immediately after
      const result = checkSubmitCooldown({ userId })

      expect(result.allowed).toBe(false)
      expect(result.remainingSeconds).toBeGreaterThan(0)
      expect(result.remainingSeconds).toBeLessThanOrEqual(60)
    })

    it('should allow submit after cooldown expires', () => {
      const userId = 'test-user-456'
      
      // Mock Date.now to simulate time passing
      const originalNow = Date.now
      const startTime = Date.now()
      
      // Record submit at start time
      Date.now = vi.fn(() => startTime)
      recordSubmit({ userId })
      
      // Fast forward 61 seconds
      Date.now = vi.fn(() => startTime + 61 * 1000)
      
      const result = checkSubmitCooldown({ userId })

      expect(result.allowed).toBe(true)
      expect(result.remainingSeconds).toBe(0)

      // Restore original Date.now
      Date.now = originalNow
    })

    it('should calculate remaining seconds correctly', () => {
      const userId = 'test-user-789'
      
      const originalNow = Date.now
      const startTime = Date.now()
      
      // Record submit at start time  
      Date.now = vi.fn(() => startTime)
      recordSubmit({ userId })
      
      // Check 30 seconds later
      Date.now = vi.fn(() => startTime + 30 * 1000)
      
      const result = checkSubmitCooldown({ userId })

      expect(result.allowed).toBe(false)
      expect(result.remainingSeconds).toBe(30)

      Date.now = originalNow
    })
  })

  describe('recordSubmit', () => {
    it('should record submit timestamp', () => {
      const userId = 'record-test-user'
      
      recordSubmit({ userId })
      
      // Should now be in cooldown
      const result = checkSubmitCooldown({ userId })
      expect(result.allowed).toBe(false)
    })

    it('should update existing user submit time', () => {
      const userId = 'update-test-user'
      const originalNow = Date.now
      const startTime = Date.now()
      
      // First submit
      Date.now = vi.fn(() => startTime)
      recordSubmit({ userId })
      
      // Second submit 5 seconds later
      Date.now = vi.fn(() => startTime + 5 * 1000)
      recordSubmit({ userId })
      
      // Check cooldown - should be based on second submit
      const result = checkSubmitCooldown({ userId })
      expect(result.allowed).toBe(false)
      expect(result.remainingSeconds).toBe(55) // 60 - 5
      
      Date.now = originalNow
    })
  })

  describe('multiple users', () => {
    it('should handle different users independently', () => {
      const user1 = 'user-1'
      const user2 = 'user-2'
      
      // Record submit for user1 only
      recordSubmit({ userId: user1 })
      
      // User1 should be blocked
      const result1 = checkSubmitCooldown({ userId: user1 })
      expect(result1.allowed).toBe(false)
      
      // User2 should be allowed
      const result2 = checkSubmitCooldown({ userId: user2 })
      expect(result2.allowed).toBe(true)
    })
  })
})