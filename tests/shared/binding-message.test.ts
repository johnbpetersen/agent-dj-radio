// tests/shared/binding-message.test.ts
// Unit tests for binding message v1 builder and parser

import { describe, it, expect } from 'vitest'
import {
  buildBindingMessageV1,
  parseBindingMessageV1,
  validateBindingMessageV1,
  maskForLogging
} from '../../src/shared/binding-message'

describe('binding-message v1', () => {
  const testChallengeId = '550e8400-e29b-41d4-a716-446655440000'
  const testTs = 1700000000
  const testTtl = 300
  const testNonce = 'a'.repeat(64) // 64 hex chars

  describe('buildBindingMessageV1', () => {
    it('should build a valid message with LF line endings', () => {
      const message = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: testTs,
        ttl: testTtl,
        nonce: testNonce
      })

      expect(message).toContain('\n')
      expect(message).not.toContain('\r\n')
      expect(message).toBe(
        `Agent DJ Radio Wallet Binding v1\nchallengeId=${testChallengeId}; ts=${testTs}; ttl=${testTtl}\nnonce=${testNonce}`
      )
    })

    it('should not add trailing newline', () => {
      const message = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: testTs,
        ttl: testTtl,
        nonce: testNonce
      })

      expect(message.endsWith('\n')).toBe(false)
    })

    it('should generate random nonce if not provided', () => {
      const message1 = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: testTs,
        ttl: testTtl
      })

      const message2 = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: testTs,
        ttl: testTtl
      })

      // Different nonces
      expect(message1).not.toBe(message2)

      // Both valid
      const parsed1 = parseBindingMessageV1(message1)
      const parsed2 = parseBindingMessageV1(message2)
      expect(parsed1.nonce).toHaveLength(64)
      expect(parsed2.nonce).toHaveLength(64)
      expect(parsed1.nonce).not.toBe(parsed2.nonce)
    })

    it('should reject invalid challengeId', () => {
      expect(() =>
        buildBindingMessageV1({
          challengeId: 'not-a-uuid',
          ts: testTs,
          ttl: testTtl,
          nonce: testNonce
        })
      ).toThrow('Invalid challengeId')
    })

    it('should reject invalid ts', () => {
      expect(() =>
        buildBindingMessageV1({
          challengeId: testChallengeId,
          ts: -1,
          ttl: testTtl,
          nonce: testNonce
        })
      ).toThrow('Invalid ts')

      expect(() =>
        buildBindingMessageV1({
          challengeId: testChallengeId,
          ts: 1.5,
          ttl: testTtl,
          nonce: testNonce
        })
      ).toThrow('Invalid ts')
    })

    it('should reject invalid ttl', () => {
      expect(() =>
        buildBindingMessageV1({
          challengeId: testChallengeId,
          ts: testTs,
          ttl: 0,
          nonce: testNonce
        })
      ).toThrow('Invalid ttl')
    })

    it('should reject invalid nonce', () => {
      expect(() =>
        buildBindingMessageV1({
          challengeId: testChallengeId,
          ts: testTs,
          ttl: testTtl,
          nonce: 'short'
        })
      ).toThrow('Invalid nonce')

      expect(() =>
        buildBindingMessageV1({
          challengeId: testChallengeId,
          ts: testTs,
          ttl: testTtl,
          nonce: 'g'.repeat(64) // not hex
        })
      ).toThrow('Invalid nonce')
    })
  })

  describe('parseBindingMessageV1', () => {
    it('should parse a valid LF message', () => {
      const message = `Agent DJ Radio Wallet Binding v1\nchallengeId=${testChallengeId}; ts=${testTs}; ttl=${testTtl}\nnonce=${testNonce}`

      const parsed = parseBindingMessageV1(message)

      expect(parsed.challengeId).toBe(testChallengeId)
      expect(parsed.ts).toBe(testTs)
      expect(parsed.ttl).toBe(testTtl)
      expect(parsed.nonce).toBe(testNonce)
      expect(parsed.lineEnding).toBe('LF')
      expect(parsed.lineCount).toBe(3)
      expect(parsed.hasTrailingNewline).toBe(false)
    })

    it('should parse a valid CRLF message', () => {
      const message = `Agent DJ Radio Wallet Binding v1\r\nchallengeId=${testChallengeId}; ts=${testTs}; ttl=${testTtl}\r\nnonce=${testNonce}`

      const parsed = parseBindingMessageV1(message)

      expect(parsed.challengeId).toBe(testChallengeId)
      expect(parsed.ts).toBe(testTs)
      expect(parsed.ttl).toBe(testTtl)
      expect(parsed.nonce).toBe(testNonce)
      expect(parsed.lineEnding).toBe('CRLF')
      expect(parsed.lineCount).toBe(3)
    })

    it('should accept trailing newline (LF)', () => {
      const message = `Agent DJ Radio Wallet Binding v1\nchallengeId=${testChallengeId}; ts=${testTs}; ttl=${testTtl}\nnonce=${testNonce}\n`

      const parsed = parseBindingMessageV1(message)

      expect(parsed.challengeId).toBe(testChallengeId)
      expect(parsed.hasTrailingNewline).toBe(true)
      expect(parsed.lineCount).toBe(3) // Blank line filtered out
    })

    it('should accept trailing newline (CRLF)', () => {
      const message = `Agent DJ Radio Wallet Binding v1\r\nchallengeId=${testChallengeId}; ts=${testTs}; ttl=${testTtl}\r\nnonce=${testNonce}\r\n`

      const parsed = parseBindingMessageV1(message)

      expect(parsed.challengeId).toBe(testChallengeId)
      expect(parsed.hasTrailingNewline).toBe(true)
    })

    it('should accept extra spaces around = and ;', () => {
      const message = `Agent DJ Radio Wallet Binding v1\nchallengeId = ${testChallengeId} ; ts = ${testTs} ; ttl = ${testTtl}\nnonce = ${testNonce}`

      const parsed = parseBindingMessageV1(message)

      expect(parsed.challengeId).toBe(testChallengeId)
      expect(parsed.ts).toBe(testTs)
      expect(parsed.ttl).toBe(testTtl)
      expect(parsed.nonce).toBe(testNonce)
    })

    it('should accept leading/trailing spaces on lines', () => {
      const message = `  Agent DJ Radio Wallet Binding v1  \n  challengeId=${testChallengeId}; ts=${testTs}; ttl=${testTtl}  \n  nonce=${testNonce}  `

      const parsed = parseBindingMessageV1(message)

      expect(parsed.challengeId).toBe(testChallengeId)
    })

    it('should reject wrong header', () => {
      const message = `Wrong Header\nchallengeId=${testChallengeId}; ts=${testTs}; ttl=${testTtl}\nnonce=${testNonce}`

      expect(() => parseBindingMessageV1(message)).toThrow(
        'line 1 must be "Agent DJ Radio Wallet Binding v1"'
      )
    })

    it('should reject wrong number of lines', () => {
      const message = `Agent DJ Radio Wallet Binding v1\nchallengeId=${testChallengeId}; ts=${testTs}; ttl=${testTtl}`

      expect(() => parseBindingMessageV1(message)).toThrow('expected 3 lines, got 2')
    })

    it('should reject missing challengeId', () => {
      const message = `Agent DJ Radio Wallet Binding v1\nts=${testTs}; ttl=${testTtl}\nnonce=${testNonce}`

      expect(() => parseBindingMessageV1(message)).toThrow(
        'line 2 must contain challengeId, ts, and ttl'
      )
    })

    it('should reject invalid challengeId format', () => {
      const message = `Agent DJ Radio Wallet Binding v1\nchallengeId=not-a-uuid; ts=${testTs}; ttl=${testTtl}\nnonce=${testNonce}`

      expect(() => parseBindingMessageV1(message)).toThrow('Invalid challengeId format')
    })

    it('should reject non-integer ts', () => {
      const message = `Agent DJ Radio Wallet Binding v1\nchallengeId=${testChallengeId}; ts=not-a-number; ttl=${testTtl}\nnonce=${testNonce}`

      expect(() => parseBindingMessageV1(message)).toThrow('ts must be an integer')
    })

    it('should reject non-positive ts', () => {
      const message = `Agent DJ Radio Wallet Binding v1\nchallengeId=${testChallengeId}; ts=-100; ttl=${testTtl}\nnonce=${testNonce}`

      expect(() => parseBindingMessageV1(message)).toThrow('ts: must be positive')
    })

    it('should reject invalid nonce format', () => {
      const message = `Agent DJ Radio Wallet Binding v1\nchallengeId=${testChallengeId}; ts=${testTs}; ttl=${testTtl}\nnonce=short`

      expect(() => parseBindingMessageV1(message)).toThrow('nonce=<64-hex>')
    })

    it('should round-trip build → parse', () => {
      const original = {
        challengeId: testChallengeId,
        ts: testTs,
        ttl: testTtl,
        nonce: testNonce
      }

      const message = buildBindingMessageV1(original)
      const parsed = parseBindingMessageV1(message)

      expect(parsed.challengeId).toBe(original.challengeId)
      expect(parsed.ts).toBe(original.ts)
      expect(parsed.ttl).toBe(original.ttl)
      expect(parsed.nonce).toBe(original.nonce)
    })
  })

  describe('validateBindingMessageV1', () => {
    it('should validate a fresh message', () => {
      const nowUnix = Math.floor(Date.now() / 1000)
      const message = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: nowUnix,
        ttl: 300,
        nonce: testNonce
      })

      const parsed = validateBindingMessageV1(message, testChallengeId, 120)

      expect(parsed.challengeId).toBe(testChallengeId)
    })

    it('should reject challengeId mismatch', () => {
      const message = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: Math.floor(Date.now() / 1000),
        ttl: 300,
        nonce: testNonce
      })

      const wrongChallengeId = '000e8400-e29b-41d4-a716-446655440000'

      expect(() => validateBindingMessageV1(message, wrongChallengeId, 120)).toThrow(
        'Challenge ID mismatch'
      )
    })

    it('should accept message within clock skew', () => {
      const nowUnix = Math.floor(Date.now() / 1000)
      const message = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: nowUnix - 100, // 100s in the past
        ttl: 300,
        nonce: testNonce
      })

      expect(() => validateBindingMessageV1(message, testChallengeId, 120)).not.toThrow()
    })

    it('should reject message beyond clock skew', () => {
      const nowUnix = Math.floor(Date.now() / 1000)
      const message = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: nowUnix - 200, // 200s in the past
        ttl: 300,
        nonce: testNonce
      })

      expect(() => validateBindingMessageV1(message, testChallengeId, 120)).toThrow(
        'Clock skew too large'
      )
    })

    it('should reject expired message', () => {
      const nowUnix = Math.floor(Date.now() / 1000)
      const message = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: nowUnix - 400, // 400s ago with ttl=300 → expired 100s ago
        ttl: 300,
        nonce: testNonce
      })

      // With default clock skew, 400s is beyond 120s, so it will fail clock skew first
      // Let's use a large clock skew to test expiry
      expect(() => validateBindingMessageV1(message, testChallengeId, 500)).toThrow(
        'Message expired'
      )
    })

    it('should accept message near expiry', () => {
      const nowUnix = Math.floor(Date.now() / 1000)
      const message = buildBindingMessageV1({
        challengeId: testChallengeId,
        ts: nowUnix - 100, // 100s ago with ttl=300 → 200s remaining
        ttl: 300,
        nonce: testNonce
      })

      expect(() => validateBindingMessageV1(message, testChallengeId, 120)).not.toThrow()
    })
  })

  describe('maskForLogging', () => {
    it('should mask challengeId and nonce', () => {
      const parsed = parseBindingMessageV1(
        buildBindingMessageV1({
          challengeId: testChallengeId,
          ts: testTs,
          ttl: testTtl,
          nonce: testNonce
        })
      )

      const masked = maskForLogging(parsed)

      expect(masked.challengeIdMasked).toMatch(/^[0-9a-f]{8}\.\.\.[0-9a-f]{4}$/)
      expect(masked.challengeIdMasked).not.toBe(testChallengeId)
      expect(masked.nonceMasked).toMatch(/^[0-9a-fA-F]{6}\.\.\.[0-9a-fA-F]{4}$/)
      expect(masked.nonceMasked).not.toBe(testNonce)
      expect(masked.ts).toBe(testTs)
      expect(masked.ttl).toBe(testTtl)
    })
  })
})
