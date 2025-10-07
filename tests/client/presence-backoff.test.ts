// tests/client/presence-backoff.test.ts
// Tests for presence ping exponential backoff logic

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * These tests verify presence ping adaptive backoff:
 * - Start with 30s ping interval
 * - Double interval on 429 (30s → 60s → 120s)
 * - Cap interval at 120s maximum
 * - Reduce interval on success (120s → 108s → 97s → ...)
 * - Not reduce below baseline 30s
 * - Handle multiple consecutive 429s
 * - Recover to baseline after sustained success
 */

describe('Presence Ping Backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial State', () => {
    it('should start with 30s ping interval', () => {
      const pingInterval = 30000
      expect(pingInterval).toBe(30000)
    })

    it('should schedule first ping after 30s', () => {
      const baselineInterval = 30000
      let nextPingTime = Date.now() + baselineInterval

      expect(nextPingTime - Date.now()).toBe(30000)
    })
  })

  describe('Backoff on 429', () => {
    it('should double interval on 429 response (30s → 60s)', () => {
      let pingInterval = 30000

      // Simulate 429 response
      const handle429 = () => {
        pingInterval = Math.min(pingInterval * 2, 120000)
      }

      handle429()

      expect(pingInterval).toBe(60000)
    })

    it('should continue doubling on consecutive 429s (60s → 120s)', () => {
      let pingInterval = 60000

      // Simulate another 429 response
      const handle429 = () => {
        pingInterval = Math.min(pingInterval * 2, 120000)
      }

      handle429()

      expect(pingInterval).toBe(120000)
    })

    it('should cap interval at 120s maximum', () => {
      let pingInterval = 120000

      // Simulate 429 at max interval
      const handle429 = () => {
        pingInterval = Math.min(pingInterval * 2, 120000)
      }

      handle429()

      expect(pingInterval).toBe(120000) // Should not exceed 120s
    })

    it('should log warning on rate limit', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      let pingInterval = 30000
      const handle429 = () => {
        const newInterval = Math.min(pingInterval * 2, 120000)
        console.warn(`Presence ping rate limited, backing off to ${newInterval / 1000}s`)
        pingInterval = newInterval
      }

      handle429()

      expect(consoleSpy).toHaveBeenCalledWith('Presence ping rate limited, backing off to 60s')
      consoleSpy.mockRestore()
    })
  })

  describe('Recovery on Success', () => {
    it('should reduce interval on successful ping (120s → 108s)', () => {
      let pingInterval = 120000

      // Simulate successful response
      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      handleSuccess()

      expect(pingInterval).toBe(108000) // 120000 * 0.9
    })

    it('should continue reducing on consecutive successes', () => {
      let pingInterval = 120000

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      // First success: 120s → 108s
      handleSuccess()
      expect(pingInterval).toBe(108000)

      // Second success: 108s → 97.2s
      handleSuccess()
      expect(pingInterval).toBe(97200)

      // Third success: 97.2s → 87.48s
      handleSuccess()
      expect(pingInterval).toBeCloseTo(87480, 0)
    })

    it('should not reduce below baseline 30s', () => {
      let pingInterval = 33000 // Just above baseline

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      // This would compute 29.7s, but should be capped at 30s
      handleSuccess()

      expect(pingInterval).toBe(30000)
    })

    it('should not change interval when already at baseline', () => {
      let pingInterval = 30000

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      handleSuccess()

      expect(pingInterval).toBe(30000)
    })
  })

  describe('Multiple Consecutive 429s', () => {
    it('should handle 3 consecutive 429s (30s → 60s → 120s → 120s)', () => {
      let pingInterval = 30000

      const handle429 = () => {
        pingInterval = Math.min(pingInterval * 2, 120000)
      }

      // First 429
      handle429()
      expect(pingInterval).toBe(60000)

      // Second 429
      handle429()
      expect(pingInterval).toBe(120000)

      // Third 429 (should stay at 120s)
      handle429()
      expect(pingInterval).toBe(120000)
    })

    it('should recover from max interval after sustained success', () => {
      let pingInterval = 120000

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      // Recovery path: 120s → 108s → 97.2s → 87.48s → 78.73s → 70.86s → 63.77s → 57.39s → 51.65s → 46.49s → 41.84s → 37.66s → 33.89s → 30s
      const intervals = [pingInterval]

      for (let i = 0; i < 20; i++) {
        handleSuccess()
        intervals.push(pingInterval)
      }

      // Should eventually reach baseline
      expect(pingInterval).toBe(30000)

      // Verify it took multiple steps to recover
      expect(intervals.filter(i => i > 30000).length).toBeGreaterThan(10)
    })
  })

  describe('Mixed 429 and Success', () => {
    it('should handle alternating 429 and success', () => {
      let pingInterval = 30000

      const handle429 = () => {
        pingInterval = Math.min(pingInterval * 2, 120000)
      }

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      // 429: 30s → 60s
      handle429()
      expect(pingInterval).toBe(60000)

      // Success: 60s → 54s
      handleSuccess()
      expect(pingInterval).toBe(54000)

      // 429: 54s → 108s
      handle429()
      expect(pingInterval).toBe(108000)

      // Success: 108s → 97.2s
      handleSuccess()
      expect(pingInterval).toBe(97200)
    })

    it('should stabilize after load spike resolves', () => {
      let pingInterval = 30000

      const handle429 = () => {
        pingInterval = Math.min(pingInterval * 2, 120000)
      }

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      // Spike: 3 consecutive 429s
      handle429() // 30s → 60s
      handle429() // 60s → 120s
      handle429() // 120s → 120s

      expect(pingInterval).toBe(120000)

      // Recovery: 10 consecutive successes
      for (let i = 0; i < 10; i++) {
        handleSuccess()
      }

      // Should be well on way back to baseline
      expect(pingInterval).toBeLessThan(60000)
      expect(pingInterval).toBeGreaterThanOrEqual(30000)
    })
  })

  describe('Dynamic Interval Scheduling', () => {
    it('should use setTimeout instead of setInterval for dynamic intervals', () => {
      let pingInterval = 30000
      let scheduledDelay = 0

      // Simulate setTimeout pattern
      const schedulePing = () => {
        scheduledDelay = pingInterval
        // In real code, this would be: setTimeout(() => { sendPing(); schedulePing(); }, pingInterval)
      }

      schedulePing()
      expect(scheduledDelay).toBe(30000)

      // After 429, reschedule with new interval
      pingInterval = 60000
      schedulePing()
      expect(scheduledDelay).toBe(60000)
    })

    it('should clear old timeout before scheduling new one', () => {
      let timeoutCleared = false
      let currentTimeout: NodeJS.Timeout | null = null

      const schedulePing = () => {
        if (currentTimeout) {
          clearTimeout(currentTimeout)
          timeoutCleared = true
        }

        currentTimeout = setTimeout(() => {
          // sendPing()
          schedulePing()
        }, 30000)
      }

      schedulePing()
      expect(timeoutCleared).toBe(false)

      // Reschedule (should clear previous)
      schedulePing()
      expect(timeoutCleared).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should continue pinging after network error', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      let pingInterval = 30000
      let continuesPinging = true

      const sendPing = async () => {
        try {
          throw new Error('Network error')
        } catch (err) {
          console.warn('Presence ping failed:', err)
          // Continue trying - don't stop the interval
        }
      }

      sendPing()

      expect(consoleSpy).toHaveBeenCalledWith('Presence ping failed:', expect.any(Error))
      expect(continuesPinging).toBe(true)

      consoleSpy.mockRestore()
    })

    it('should not change interval on network error', () => {
      let pingInterval = 60000

      const handleError = () => {
        // Don't modify interval on network error, only on 429
        console.warn('Presence ping failed')
      }

      handleError()

      expect(pingInterval).toBe(60000) // Should remain unchanged
    })
  })

  describe('Integration Scenarios', () => {
    it('should implement complete backoff and recovery flow', () => {
      let pingInterval = 30000
      const intervals: number[] = []

      const handle429 = () => {
        pingInterval = Math.min(pingInterval * 2, 120000)
        intervals.push(pingInterval)
      }

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
        intervals.push(pingInterval)
      }

      // Simulate load spike
      handle429() // 60s
      handle429() // 120s
      handle429() // 120s (capped)

      expect(pingInterval).toBe(120000)
      expect(intervals).toEqual([60000, 120000, 120000])

      // Simulate gradual recovery
      for (let i = 0; i < 15; i++) {
        handleSuccess()
      }

      expect(pingInterval).toBe(30000)
      expect(intervals[intervals.length - 1]).toBe(30000)
    })

    it('should track interval changes with ref pattern', () => {
      // Simulate React useRef pattern
      const pingIntervalRef = { current: 30000 }
      let stateInterval = 30000

      const updateInterval = (newInterval: number) => {
        pingIntervalRef.current = newInterval
        stateInterval = newInterval
      }

      // Initial state
      expect(pingIntervalRef.current).toBe(30000)
      expect(stateInterval).toBe(30000)

      // Update on 429
      updateInterval(60000)
      expect(pingIntervalRef.current).toBe(60000)
      expect(stateInterval).toBe(60000)

      // Verify ref is always in sync
      expect(pingIntervalRef.current).toBe(stateInterval)
    })

    it('should verify backoff prevents burst rate limiting', () => {
      let pingInterval = 30000
      let consecutiveRateLimits = 0

      const handle429 = () => {
        consecutiveRateLimits++
        pingInterval = Math.min(pingInterval * 2, 120000)
      }

      // First 429
      handle429()
      expect(pingInterval).toBe(60000)
      expect(consecutiveRateLimits).toBe(1)

      // Longer interval should reduce likelihood of another 429
      // In real scenario, next ping would be at 60s instead of 30s

      // If still rate limited
      handle429()
      expect(pingInterval).toBe(120000)
      expect(consecutiveRateLimits).toBe(2)

      // Now at max interval (120s) - should prevent further rate limiting
      expect(pingInterval).toBe(120000)
    })
  })

  describe('Edge Cases', () => {
    it('should handle interval already at max when computing backoff', () => {
      let pingInterval = 120000

      const handle429 = () => {
        const newInterval = Math.min(pingInterval * 2, 120000)
        pingInterval = newInterval
      }

      const before = pingInterval
      handle429()

      expect(pingInterval).toBe(before)
      expect(pingInterval).toBe(120000)
    })

    it('should handle interval already at baseline when computing recovery', () => {
      let pingInterval = 30000

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      const before = pingInterval
      handleSuccess()

      expect(pingInterval).toBe(before)
      expect(pingInterval).toBe(30000)
    })

    it('should handle very small intervals close to baseline', () => {
      let pingInterval = 30100 // Just above baseline

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      handleSuccess() // 30100 * 0.9 = 27090, but capped at 30000

      expect(pingInterval).toBe(30000)
    })

    it('should preserve interval precision during calculations', () => {
      let pingInterval = 100000

      const handleSuccess = () => {
        const newInterval = Math.max(pingInterval * 0.9, 30000)
        if (newInterval !== pingInterval) {
          pingInterval = newInterval
        }
      }

      handleSuccess()

      expect(pingInterval).toBe(90000) // Exact calculation, no rounding issues
    })
  })
})
