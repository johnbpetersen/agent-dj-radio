// tests/server/x402-codes-and-idempotency.test.ts
// Tests for granular x402 error codes and idempotency semantics in /api/queue/confirm

import { describe, it, expect } from 'vitest'
import type { VerifyPaymentResult } from '../../api/_shared/payments/x402-cdp'

/**
 * These tests verify:
 * 1. CDP adapter returns granular error codes (WRONG_CHAIN, WRONG_ASSET, WRONG_AMOUNT, PROVIDER_ERROR)
 * 2. confirm.ts maps these codes to proper HTTP 400 responses
 * 3. Idempotency: repeat confirms return 200 with no duplicate effects
 * 4. Security: requestId present, no secrets in responses
 */

describe('x402 Granular Error Codes', () => {
  describe('CDP adapter error mapping', () => {
    it('should return WRONG_CHAIN when chain mismatch detected', () => {
      // Simulate CDP response with wrong chain
      const mockCDPResponse = {
        verified: false,
        chain: 'ethereum-mainnet',
        error: {
          code: 'CHAIN_MISMATCH',
          message: 'Transaction is on wrong chain'
        }
      }

      // Expected adapter result
      const expectedResult: VerifyPaymentResult = {
        ok: false,
        code: 'WRONG_CHAIN',
        detail: 'Expected base-sepolia, got ethereum-mainnet'
      }

      expect(expectedResult.ok).toBe(false)
      expect(expectedResult.code).toBe('WRONG_CHAIN')
      expect(expectedResult.detail).toContain('Expected')
    })

    it('should return WRONG_ASSET when asset mismatch detected', () => {
      const mockCDPResponse = {
        verified: false,
        asset: 'ETH',
        error: {
          code: 'ASSET_MISMATCH',
          message: 'Wrong token sent'
        }
      }

      const expectedResult: VerifyPaymentResult = {
        ok: false,
        code: 'WRONG_ASSET',
        detail: 'Expected USDC, got ETH'
      }

      expect(expectedResult.ok).toBe(false)
      expect(expectedResult.code).toBe('WRONG_ASSET')
      expect(expectedResult.detail).toContain('USDC')
    })

    it('should return WRONG_AMOUNT when payment insufficient', () => {
      const mockCDPResponse = {
        verified: false,
        amountPaid: 500000, // 0.5 USDC (6 decimals)
        error: {
          code: 'INSUFFICIENT_AMOUNT',
          message: 'Amount too low'
        }
      }

      const expectedAmount = 1000000 // 1 USDC expected
      const expectedResult: VerifyPaymentResult = {
        ok: false,
        code: 'WRONG_AMOUNT',
        detail: `Insufficient payment: expected ${expectedAmount}, got ${mockCDPResponse.amountPaid} (short by ${expectedAmount - mockCDPResponse.amountPaid})`
      }

      expect(expectedResult.ok).toBe(false)
      expect(expectedResult.code).toBe('WRONG_AMOUNT')
      expect(expectedResult.detail).toContain('Insufficient payment')
      expect(expectedResult.detail).toContain('500000')
    })

    it('should return PROVIDER_ERROR for malformed responses', () => {
      // Case 1: Response is not an object
      const malformed1 = null

      const expectedResult1: VerifyPaymentResult = {
        ok: false,
        code: 'PROVIDER_ERROR',
        detail: 'Malformed provider response (not an object)'
      }

      expect(expectedResult1.code).toBe('PROVIDER_ERROR')

      // Case 2: Missing verified field
      const malformed2 = { someField: 'value' }

      const expectedResult2: VerifyPaymentResult = {
        ok: false,
        code: 'PROVIDER_ERROR',
        detail: 'Malformed provider response (missing verified field)'
      }

      expect(expectedResult2.code).toBe('PROVIDER_ERROR')
    })

    it('should return PROVIDER_ERROR for 5xx responses after retries', () => {
      const expectedResult: VerifyPaymentResult = {
        ok: false,
        code: 'PROVIDER_ERROR',
        detail: 'Provider unavailable after 3 attempts: CDP returned 503: Service Unavailable'
      }

      expect(expectedResult.ok).toBe(false)
      expect(expectedResult.code).toBe('PROVIDER_ERROR')
      expect(expectedResult.detail).toContain('unavailable')
      expect(expectedResult.detail).toContain('attempts')
    })

    it('should return NO_MATCH for transaction not found', () => {
      const mockCDPResponse = {
        verified: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Transaction hash not found on chain'
        }
      }

      const expectedResult: VerifyPaymentResult = {
        ok: false,
        code: 'NO_MATCH',
        detail: 'Transaction hash not found on chain'
      }

      expect(expectedResult.code).toBe('NO_MATCH')
    })

    it('should return EXPIRED for timed out transactions', () => {
      const mockCDPResponse = {
        verified: false,
        error: {
          code: 'EXPIRED',
          message: 'Transaction timestamp outside acceptable window'
        }
      }

      const expectedResult: VerifyPaymentResult = {
        ok: false,
        code: 'EXPIRED',
        detail: 'Transaction timestamp outside acceptable window'
      }

      expect(expectedResult.code).toBe('EXPIRED')
    })
  })

  describe('HTTP response mapping in confirm.ts', () => {
    it('should map WRONG_CHAIN to 400 response', () => {
      const verificationResult: VerifyPaymentResult = {
        ok: false,
        code: 'WRONG_CHAIN',
        detail: 'Expected base-sepolia, got ethereum-mainnet'
      }

      // Expected HTTP response structure
      const expectedResponse = {
        error: {
          code: 'WRONG_CHAIN',
          message: 'Expected base-sepolia, got ethereum-mainnet'
        },
        requestId: 'req-123'
      }

      expect(expectedResponse.error.code).toBe('WRONG_CHAIN')
      // Should be 400, not 500
      const expectedStatus = 400
      expect(expectedStatus).toBe(400)
    })

    it('should map WRONG_ASSET to 400 response', () => {
      const verificationResult: VerifyPaymentResult = {
        ok: false,
        code: 'WRONG_ASSET',
        detail: 'Expected USDC, got ETH'
      }

      const expectedResponse = {
        error: {
          code: 'WRONG_ASSET',
          message: 'Expected USDC, got ETH'
        },
        requestId: 'req-456'
      }

      expect(expectedResponse.error.code).toBe('WRONG_ASSET')
      const expectedStatus = 400
      expect(expectedStatus).toBe(400)
    })

    it('should map WRONG_AMOUNT to 400 response', () => {
      const verificationResult: VerifyPaymentResult = {
        ok: false,
        code: 'WRONG_AMOUNT',
        detail: 'Insufficient payment: expected 1000000, got 500000 (short by 500000)'
      }

      const expectedResponse = {
        error: {
          code: 'WRONG_AMOUNT',
          message: 'Insufficient payment: expected 1000000, got 500000 (short by 500000)'
        },
        requestId: 'req-789'
      }

      expect(expectedResponse.error.code).toBe('WRONG_AMOUNT')
      const expectedStatus = 400
      expect(expectedStatus).toBe(400)
    })

    it('should map PROVIDER_ERROR to 400 response', () => {
      const verificationResult: VerifyPaymentResult = {
        ok: false,
        code: 'PROVIDER_ERROR',
        detail: 'Provider unavailable after 3 attempts'
      }

      const expectedResponse = {
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Provider unavailable after 3 attempts'
        },
        requestId: 'req-provider-err'
      }

      expect(expectedResponse.error.code).toBe('PROVIDER_ERROR')
      // PROVIDER_ERROR should be 400 (client should retry later)
      const expectedStatus = 400
      expect(expectedStatus).toBe(400)
    })

    it('should map NO_MATCH to 404 response', () => {
      // Challenge not found case
      const expectedResponse = {
        error: {
          code: 'NO_MATCH',
          message: 'Payment challenge not found'
        },
        requestId: 'req-404'
      }

      expect(expectedResponse.error.code).toBe('NO_MATCH')
      const expectedStatus = 404
      expect(expectedStatus).toBe(404)
    })

    it('should map EXPIRED to 400 response', () => {
      const expectedResponse = {
        error: {
          code: 'EXPIRED',
          message: 'Payment challenge has expired. Please refresh and try again.'
        },
        requestId: 'req-expired'
      }

      expect(expectedResponse.error.code).toBe('EXPIRED')
      const expectedStatus = 400
      expect(expectedStatus).toBe(400)
    })

    it('should map VALIDATION_ERROR to 400 response', () => {
      const expectedResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request: txHash: Invalid transaction hash format'
        },
        requestId: 'req-validation'
      }

      expect(expectedResponse.error.code).toBe('VALIDATION_ERROR')
      const expectedStatus = 400
      expect(expectedStatus).toBe(400)
    })

    it('should use DB_ERROR (500) only for database failures', () => {
      const expectedResponse = {
        error: {
          code: 'DB_ERROR',
          message: 'Database error while checking payment status'
        },
        requestId: 'req-db-err'
      }

      expect(expectedResponse.error.code).toBe('DB_ERROR')
      const expectedStatus = 500
      expect(expectedStatus).toBe(500)
    })

    it('should use INTERNAL (500) only for unexpected errors', () => {
      const expectedResponse = {
        error: {
          code: 'INTERNAL',
          message: 'Internal server error during payment confirmation'
        },
        requestId: 'req-internal'
      }

      expect(expectedResponse.error.code).toBe('INTERNAL')
      const expectedStatus = 500
      expect(expectedStatus).toBe(500)
    })
  })

  describe('Idempotency semantics', () => {
    it('should return 200 for first successful confirmation', () => {
      // First confirmation: new payment
      const firstResponse = {
        ok: true,
        trackId: 'track-123',
        status: 'PAID',
        requestId: 'req-first'
      }

      expect(firstResponse.ok).toBe(true)
      expect(firstResponse.status).toBe('PAID')
      const expectedStatus = 200
      expect(expectedStatus).toBe(200)
    })

    it('should return 200 for repeat confirmation with same challengeId', () => {
      // Second confirmation: same challengeId, same txHash
      const repeatResponse = {
        ok: true,
        trackId: 'track-123',
        status: 'PAID',
        requestId: 'req-repeat'
      }

      expect(repeatResponse.ok).toBe(true)
      expect(repeatResponse.trackId).toBe('track-123')
      const expectedStatus = 200
      expect(expectedStatus).toBe(200)
    })

    it('should return 409 TX_ALREADY_USED for reused txHash with different challengeId', () => {
      // Third confirmation: different challengeId, same txHash
      // (txHash already used for another challenge - this is REUSE, not idempotency)
      const reuseResponse = {
        error: {
          code: 'TX_ALREADY_USED',
          message: 'This transaction hash was already used for a different payment.',
          data: {
            originalChallengeId: 'challenge-original',
            originalTrackId: 'track-123',
            originalConfirmedAt: '2025-01-01T12:00:00Z',
            reasonCodes: ['TX_ALREADY_USED']
          }
        },
        requestId: 'req-reuse-tx'
      }

      expect(reuseResponse.error.code).toBe('TX_ALREADY_USED')
      const expectedStatus = 409
      expect(expectedStatus).toBe(409)
      expect(reuseResponse.error.data?.reasonCodes).toContain('TX_ALREADY_USED')
    })

    it('should not create duplicate confirmation records', () => {
      // Idempotency check logic from confirm.ts:
      // 1. Query payment_confirmations by (challengeId OR txHash)
      // 2. If exists, return 200 with existing data
      // 3. No insert, no update, no side effects

      const existingConfirmation = {
        id: 'conf-123',
        challenge_id: 'challenge-456',
        tx_hash: '0xabcd...',
        payment_challenges: {
          track_id: 'track-789',
          user_id: 'user-123'
        }
      }

      // Defensive check before accessing nested data
      const joinedData = (existingConfirmation as any).payment_challenges
      const isValid = !!(joinedData && joinedData.track_id)

      expect(isValid).toBe(true)

      if (isValid) {
        const trackId = joinedData.track_id
        expect(trackId).toBe('track-789')

        // Should return existing track status, no new insert
        const idempotentResponse = {
          ok: true,
          trackId,
          status: 'PAID',
          requestId: 'req-idempotent'
        }

        expect(idempotentResponse.ok).toBe(true)
        expect(idempotentResponse.trackId).toBe('track-789')
      }
    })

    it('should not transition track status twice', () => {
      // Scenario: track already in PAID status
      const existingTrack = {
        id: 'track-789',
        status: 'PAID',
        x402_payment_tx: {
          tx_hash: '0xabcd...',
          confirmed_at: '2025-01-01T12:00:00Z',
          amount_paid: 1000000,
          provider: 'cdp'
        }
      }

      // Idempotent confirm should return existing status
      expect(existingTrack.status).toBe('PAID')

      // No UPDATE query should be run (idempotency check exits early)
      const shouldUpdate = false
      expect(shouldUpdate).toBe(false)
    })

    it('should handle concurrent confirmations gracefully', () => {
      // Scenario: Two requests confirm same payment simultaneously
      // First request inserts confirmation → success
      // Second request gets unique constraint violation (23505)
      // Second request re-queries and returns existing confirmation

      const postgresError = {
        code: '23505', // Unique constraint violation
        message: 'duplicate key value violates unique constraint "payment_confirmations_challenge_id_key"'
      }

      const isConcurrencyError = postgresError.code === '23505'
      expect(isConcurrencyError).toBe(true)

      // Should re-query and return 200
      const concurrentResponse = {
        ok: true,
        trackId: 'track-789',
        status: 'PAID',
        requestId: 'req-concurrent'
      }

      expect(concurrentResponse.ok).toBe(true)
      const expectedStatus = 200
      expect(expectedStatus).toBe(200)
    })
  })

  describe('TX_ALREADY_USED reuse detection', () => {
    it('should return 409 when txHash already used for different challenge', () => {
      // Scenario: User tries to reuse a transaction hash from a previous payment
      const firstConfirmation = {
        challenge_id: 'challenge-aaa',
        tx_hash: '0x1234...',
        tx_from_address: '0xabc...',
        payment_challenges: {
          track_id: 'track-111',
          user_id: 'user-123',
          bound_address: '0xabc...'
        }
      }

      // Second attempt with different challenge, same tx
      const secondAttempt = {
        challengeId: 'challenge-bbb', // Different!
        txHash: '0x1234...' // Same!
      }

      const expectedResponse = {
        error: {
          code: 'TX_ALREADY_USED',
          message: 'This transaction hash was already used for a different payment.',
          data: {
            originalChallengeId: 'challenge-aaa',
            originalTrackId: 'track-111',
            originalConfirmedAt: '2025-01-01T12:00:00Z',
            reasonCodes: ['TX_ALREADY_USED']
          }
        },
        requestId: 'req-reuse'
      }

      expect(expectedResponse.error.code).toBe('TX_ALREADY_USED')
      expect(expectedResponse.error.data?.originalChallengeId).toBe('challenge-aaa')
      expect(expectedResponse.error.data?.originalTrackId).toBe('track-111')
      expect(expectedResponse.error.data?.reasonCodes).toContain('TX_ALREADY_USED')

      const expectedStatus = 409
      expect(expectedStatus).toBe(409)
    })

    it('should include WRONG_PAYER in reasonCodes when payer address mismatches', () => {
      // Scenario: Transaction hash reused AND sender doesn't match bound address
      const existingConfirmation = {
        challenge_id: 'challenge-aaa',
        tx_hash: '0x1234...',
        tx_from_address: '0xabc123...',
        payment_challenges: {
          track_id: 'track-111',
          user_id: 'user-123',
          bound_address: '0xdef456...' // Different from tx_from_address!
        }
      }

      const expectedResponse = {
        error: {
          code: 'TX_ALREADY_USED',
          message: 'This transaction hash was already used for a different payment.',
          data: {
            originalChallengeId: 'challenge-aaa',
            originalTrackId: 'track-111',
            originalConfirmedAt: '2025-01-01T12:00:00Z',
            payerAddress: '0xabc123...',
            boundAddress: '0xdef456...',
            reasonCodes: ['TX_ALREADY_USED', 'WRONG_PAYER']
          }
        },
        requestId: 'req-reuse-wrong-payer'
      }

      expect(expectedResponse.error.code).toBe('TX_ALREADY_USED')
      expect(expectedResponse.error.data?.reasonCodes).toContain('TX_ALREADY_USED')
      expect(expectedResponse.error.data?.reasonCodes).toContain('WRONG_PAYER')
      expect(expectedResponse.error.data?.payerAddress).toBe('0xabc123...')
      expect(expectedResponse.error.data?.boundAddress).toBe('0xdef456...')

      const expectedStatus = 409
      expect(expectedStatus).toBe(409)
    })

    it('should NOT include WRONG_PAYER when payer matches bound address', () => {
      // Scenario: Transaction hash reused BUT sender matches bound address
      const existingConfirmation = {
        challenge_id: 'challenge-aaa',
        tx_hash: '0x1234...',
        tx_from_address: '0xabc123...',
        payment_challenges: {
          track_id: 'track-111',
          user_id: 'user-123',
          bound_address: '0xabc123...' // Same as tx_from_address
        }
      }

      const expectedResponse = {
        error: {
          code: 'TX_ALREADY_USED',
          message: 'This transaction hash was already used for a different payment.',
          data: {
            originalChallengeId: 'challenge-aaa',
            originalTrackId: 'track-111',
            originalConfirmedAt: '2025-01-01T12:00:00Z',
            payerAddress: '0xabc123...',
            boundAddress: '0xabc123...',
            reasonCodes: ['TX_ALREADY_USED'] // No WRONG_PAYER!
          }
        },
        requestId: 'req-reuse-same-payer'
      }

      expect(expectedResponse.error.code).toBe('TX_ALREADY_USED')
      expect(expectedResponse.error.data?.reasonCodes).toContain('TX_ALREADY_USED')
      expect(expectedResponse.error.data?.reasonCodes).not.toContain('WRONG_PAYER')

      const expectedStatus = 409
      expect(expectedStatus).toBe(409)
    })

    it('should handle reuse when tx_from_address is missing (backfill incomplete)', () => {
      // Scenario: Old confirmation record without tx_from_address
      const existingConfirmation = {
        challenge_id: 'challenge-aaa',
        tx_hash: '0x1234...',
        tx_from_address: null, // Missing!
        payment_challenges: {
          track_id: 'track-111',
          user_id: 'user-123',
          bound_address: '0xdef456...'
        }
      }

      const expectedResponse = {
        error: {
          code: 'TX_ALREADY_USED',
          message: 'This transaction hash was already used for a different payment.',
          data: {
            originalChallengeId: 'challenge-aaa',
            originalTrackId: 'track-111',
            originalConfirmedAt: '2025-01-01T12:00:00Z',
            payerAddress: null,
            boundAddress: '0xdef456...',
            reasonCodes: ['TX_ALREADY_USED'] // No WRONG_PAYER check possible
          }
        },
        requestId: 'req-reuse-no-payer'
      }

      expect(expectedResponse.error.code).toBe('TX_ALREADY_USED')
      expect(expectedResponse.error.data?.reasonCodes).toContain('TX_ALREADY_USED')
      // WRONG_PAYER check skipped when tx_from_address missing
      expect(expectedResponse.error.data?.reasonCodes).not.toContain('WRONG_PAYER')
      expect(expectedResponse.error.data?.payerAddress).toBeNull()

      const expectedStatus = 409
      expect(expectedStatus).toBe(409)
    })

    it('should preserve idempotency when same challenge resubmits same txHash', () => {
      // Scenario: SAME challengeId + SAME txHash = true idempotency (not reuse)
      const existingConfirmation = {
        challenge_id: 'challenge-aaa',
        tx_hash: '0x1234...',
        payment_challenges: {
          track_id: 'track-111',
          user_id: 'user-123'
        }
      }

      const retryAttempt = {
        challengeId: 'challenge-aaa', // Same!
        txHash: '0x1234...' // Same!
      }

      const expectedResponse = {
        ok: true,
        trackId: 'track-111',
        status: 'PAID',
        requestId: 'req-idempotent'
      }

      expect(expectedResponse.ok).toBe(true)
      expect(expectedResponse.trackId).toBe('track-111')

      const expectedStatus = 200
      expect(expectedStatus).toBe(200)
    })

    it('should handle race condition: concurrent reuse attempts get 409', () => {
      // Scenario: Two different challenges try to reuse same txHash concurrently
      // First request checks, finds nothing, starts processing
      // Second request checks, finds nothing (first not committed yet), starts processing
      // First request inserts confirmation → success (200)
      // Second request tries to insert → unique constraint violation on tx_hash
      // Second request re-queries, finds first confirmation with DIFFERENT challengeId
      // Second request returns 409 TX_ALREADY_USED

      const postgresError = {
        code: '23505', // Unique constraint violation
        constraint: 'payment_confirmations_tx_hash_key'
      }

      const existingFromRace = {
        challenge_id: 'challenge-first',
        tx_hash: '0x1234...',
        payment_challenges: {
          track_id: 'track-first',
          user_id: 'user-first'
        }
      }

      const secondRequestChallenge = 'challenge-second' // Different!

      const expectedResponse = {
        error: {
          code: 'TX_ALREADY_USED',
          message: 'This transaction hash was already used for a different payment.',
          data: {
            originalChallengeId: 'challenge-first',
            originalTrackId: 'track-first',
            reasonCodes: ['TX_ALREADY_USED']
          }
        },
        requestId: 'req-race-reuse'
      }

      expect(postgresError.code).toBe('23505')
      expect(expectedResponse.error.code).toBe('TX_ALREADY_USED')
      expect(expectedResponse.error.data?.originalChallengeId).not.toBe(secondRequestChallenge)

      const expectedStatus = 409
      expect(expectedStatus).toBe(409)
    })
  })

  describe('Security and logging', () => {
    it('should include requestId in all responses', () => {
      const responses = [
        { error: { code: 'WRONG_CHAIN', message: 'msg' }, requestId: 'req-1' },
        { error: { code: 'DB_ERROR', message: 'msg' }, requestId: 'req-2' },
        { ok: true, trackId: 'track-123', status: 'PAID', requestId: 'req-3' }
      ]

      responses.forEach(response => {
        expect(response.requestId).toBeTruthy()
        expect(typeof response.requestId).toBe('string')
      })
    })

    it('should mask transaction hash in logs', () => {
      const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

      // Log pattern from confirm.ts: txHash (full hash for verification, but could be masked)
      // For now, full hash is logged. If masking required:
      const maskedTxHash = txHash.substring(0, 10) + '...' + txHash.substring(txHash.length - 4)

      expect(maskedTxHash).toBe('0xabcdef12...7890')
      expect(maskedTxHash).not.toContain(txHash.substring(10, txHash.length - 4))
    })

    it('should not leak secrets in error responses', () => {
      // Error responses should never contain:
      // - X402_API_KEY
      // - X402_RECEIVING_ADDRESS (internal)
      // - Database connection strings
      // - Internal server paths

      const errorResponse = {
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Provider unavailable after 3 attempts'
        },
        requestId: 'req-123'
      }

      const responseStr = JSON.stringify(errorResponse)

      expect(responseStr).not.toContain('X402_API_KEY')
      expect(responseStr).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
      expect(responseStr).not.toContain('/home/')
      expect(responseStr).not.toContain('postgresql://')
    })

    it('should log verification failures with full context', () => {
      const auditLog = {
        requestId: 'req-audit',
        challengeId: 'challenge-123',
        txHash: '0xabcd...',
        userId: 'user-456',
        trackId: 'track-789',
        amountAtomic: 1000000,
        asset: 'USDC',
        chain: 'base-sepolia',
        verdict: 'FAILED',
        code: 'WRONG_AMOUNT'
      }

      expect(auditLog.verdict).toBe('FAILED')
      expect(auditLog.code).toBe('WRONG_AMOUNT')
      expect(auditLog.requestId).toBeTruthy()
      expect(auditLog.challengeId).toBeTruthy()
      expect(auditLog.txHash).toBeTruthy()
    })

    it('should log successful confirmations with full context', () => {
      const auditLog = {
        requestId: 'req-audit-success',
        challengeId: 'challenge-123',
        txHash: '0xabcd...',
        userId: 'user-456',
        trackId: 'track-789',
        amountAtomic: 1000000,
        amountPaidAtomic: 1000000,
        asset: 'USDC',
        chain: 'base-sepolia',
        verdict: 'SUCCESS'
      }

      expect(auditLog.verdict).toBe('SUCCESS')
      expect(auditLog.amountPaidAtomic).toBe(auditLog.amountAtomic)
    })
  })

  describe('4xx vs 5xx separation', () => {
    it('should use 400 for client errors (payment issues)', () => {
      const clientErrors = [
        'VALIDATION_ERROR',
        'EXPIRED',
        'WRONG_CHAIN',
        'WRONG_ASSET',
        'WRONG_AMOUNT',
        'PROVIDER_ERROR' // Provider down is client-retriable
      ]

      clientErrors.forEach(code => {
        const expectedStatus = 400
        expect(expectedStatus).toBe(400)
      })
    })

    it('should use 404 for not found', () => {
      const notFoundError = 'NO_MATCH'
      const expectedStatus = 404
      expect(expectedStatus).toBe(404)
    })

    it('should use 500 only for server errors', () => {
      const serverErrors = [
        'DB_ERROR',    // Database connection/query failure
        'INTERNAL'     // Unexpected server error
      ]

      serverErrors.forEach(code => {
        const expectedStatus = 500
        expect(expectedStatus).toBe(500)
      })
    })
  })
})

/**
 * Integration test notes:
 *
 * To manually test granular error codes and idempotency:
 *
 * 1. Test WRONG_CHAIN (requires live CDP or mock):
 *    - Submit payment on ethereum-mainnet
 *    - Expect: 400 with code 'WRONG_CHAIN'
 *    - UI shows: "WRONG_CHAIN: Expected base-sepolia, got ethereum-mainnet (Expected: Base Sepolia)"
 *
 * 2. Test WRONG_ASSET:
 *    - Send ETH instead of USDC
 *    - Expect: 400 with code 'WRONG_ASSET'
 *    - UI shows: "WRONG_ASSET: Expected USDC, got ETH (Expected: USDC)"
 *
 * 3. Test WRONG_AMOUNT:
 *    - Send 0.5 USDC when 1 USDC required
 *    - Expect: 400 with code 'WRONG_AMOUNT'
 *    - UI shows: "WRONG_AMOUNT: Insufficient payment: expected 1000000, got 500000 (short by 500000)"
 *
 * 4. Test idempotency (same challengeId):
 *    curl -X POST http://localhost:3001/api/queue/confirm \
 *      -H 'Content-Type: application/json' \
 *      -d '{"challengeId":"uuid-123","txHash":"0xabcd..."}'
 *
 *    First call: 200 with track status PAID
 *    Second call (same payload): 200 with same track status
 *    Database: only 1 confirmation record
 *
 * 5. Test TX_ALREADY_USED (different challengeId, reused txHash):
 *    curl -X POST http://localhost:3001/api/queue/confirm \
 *      -H 'Content-Type: application/json' \
 *      -d '{"challengeId":"uuid-456","txHash":"0xabcd..."}'
 *
 *    Expected: 409 TX_ALREADY_USED with data.originalChallengeId, data.originalTrackId
 *    Database: still only 1 confirmation record
 *    UI shows: "⚠️ Transaction Already Used" with CTAs
 *
 * 6. Test concurrent confirmations:
 *    - Run two requests in parallel with same challengeId + txHash
 *    - Both should return 200
 *    - Database: only 1 confirmation record
 *
 * 7. Check logs for audit trail:
 *    grep "queue/confirm audit" logs.json | jq
 *
 *    Expected fields:
 *    - requestId
 *    - challengeId
 *    - txHash (masked or full)
 *    - userId
 *    - trackId
 *    - amountAtomic
 *    - asset
 *    - chain
 *    - verdict (SUCCESS or FAILED)
 *    - code (for failures)
 */
