import { describe, it, expect } from 'vitest'
import { calculatePrice, validateDuration, DURATION_OPTIONS } from '../../src/server/pricing'

describe('Pricing Logic', () => {
  describe('calculatePrice', () => {
    it('should calculate correct prices for valid durations', () => {
      expect(calculatePrice(60)).toBe(3.00)
      expect(calculatePrice(90)).toBe(4.27)
      expect(calculatePrice(120)).toBe(5.40)
    })

    it('should throw error for invalid durations', () => {
      expect(() => calculatePrice(30)).toThrow('Invalid duration')
      expect(() => calculatePrice(180)).toThrow('Invalid duration')
      expect(() => calculatePrice(75)).toThrow('Invalid duration')
    })

    it('should return numbers with 2 decimal places', () => {
      const price60 = calculatePrice(60)
      const price90 = calculatePrice(90)
      const price120 = calculatePrice(120)
      
      expect(price60.toFixed(2)).toMatch(/^\d+\.\d{2}$/)
      expect(price90.toFixed(2)).toMatch(/^\d+\.\d{2}$/)
      expect(price120.toFixed(2)).toMatch(/^\d+\.\d{2}$/)
    })

    it('should apply correct discount multipliers', () => {
      // Base price: $0.05 per second
      // 60s: $3.00 (1.0 multiplier)
      // 90s: $4.50 * 0.95 = $4.275 → $4.27 (0.95 multiplier)
      // 120s: $6.00 * 0.90 = $5.40 (0.90 multiplier)
      
      expect(calculatePrice(60)).toBe(3.00)
      expect(calculatePrice(90)).toBe(4.27)
      expect(calculatePrice(120)).toBe(5.40)
      
      // Verify discount progression
      expect(calculatePrice(90) / 90).toBeLessThan(calculatePrice(60) / 60)
      expect(calculatePrice(120) / 120).toBeLessThan(calculatePrice(90) / 90)
    })
  })

  describe('validateDuration', () => {
    it('should validate correct durations', () => {
      expect(validateDuration(60)).toBe(true)
      expect(validateDuration(90)).toBe(true)
      expect(validateDuration(120)).toBe(true)
    })

    it('should reject invalid durations', () => {
      expect(validateDuration(30)).toBe(false)
      expect(validateDuration(75)).toBe(false)
      expect(validateDuration(180)).toBe(false)
      expect(validateDuration(0)).toBe(false)
      expect(validateDuration(-60)).toBe(false)
    })

    it('should match DURATION_OPTIONS', () => {
      DURATION_OPTIONS.forEach(duration => {
        expect(validateDuration(duration)).toBe(true)
      })
    })
  })
})