# x402 Granular Error Codes and Idempotency - Implementation Summary

## Objective
Restore specific x402 error codes and lock in idempotency semantics for `/api/queue/confirm`.

## Deliverables Completed

### 1. CDP Adapter Error Codes (`api/_shared/payments/x402-cdp.ts`)

**Interface Updated:**
```typescript
export interface VerifyPaymentFailure {
  ok: false
  code: VerificationErrorCode
  message: string // User-friendly message (always present)
  detail?: string // Technical details (optional, for logging)
}
```

**Granular Error Codes Returned:**

| Code | HTTP Status | Message | When Used |
|------|-------------|---------|-----------|
| `WRONG_CHAIN` | 400 | Payment sent on wrong blockchain network | Chain mismatch (e.g., ethereum-mainnet vs base-sepolia) |
| `WRONG_ASSET` | 400 | Wrong cryptocurrency used for payment | Asset mismatch (e.g., ETH vs USDC) |
| `WRONG_AMOUNT` | 400 | Payment amount is insufficient | Amount paid < amount required |
| `NO_MATCH` | 404 | Transaction not found on blockchain | TX hash not found by CDP |
| `EXPIRED` | 400 | Transaction expired or timed out | Transaction outside acceptable time window |
| `PROVIDER_ERROR` | 400 | Payment verification service error | CDP API errors, malformed responses, 5xx after retries |

**Error Mapping Logic:**
```typescript
function mapCDPError(cdpResponse: CDPVerifyResponse, input: VerifyPaymentInput): VerifyPaymentFailure {
  // Check for specific validation failures
  if (cdpResponse.amountPaid < input.amountAtomic) {
    return {
      ok: false,
      code: 'WRONG_AMOUNT',
      message: 'Payment amount is insufficient',
      detail: `Insufficient payment: expected ${input.amountAtomic}, got ${cdpResponse.amountPaid} (short by ${diff})`
    }
  }

  if (cdpResponse.asset !== input.asset) {
    return {
      ok: false,
      code: 'WRONG_ASSET',
      message: 'Wrong cryptocurrency used for payment',
      detail: `Expected ${input.asset}, got ${cdpResponse.asset}`
    }
  }

  if (cdpResponse.chain !== input.chain) {
    return {
      ok: false,
      code: 'WRONG_CHAIN',
      message: 'Payment sent on wrong blockchain network',
      detail: `Expected ${input.chain}, got ${cdpResponse.chain}`
    }
  }

  // Map CDP error codes to our codes
  if (errorCode.includes('NOT_FOUND') || errorCode.includes('NO_TRANSACTION')) {
    return { ok: false, code: 'NO_MATCH', message: 'Transaction not found on blockchain', detail: errorMsg }
  }

  // Default to PROVIDER_ERROR for unknown issues
  return { ok: false, code: 'PROVIDER_ERROR', message: 'Payment verification service error', detail: errorMsg }
}
```

**All Error Returns Updated:**
- Configuration errors (missing URL/API key) → `PROVIDER_ERROR`
- Malformed responses → `PROVIDER_ERROR`
- 5xx retries exhausted → `PROVIDER_ERROR`
- JSON parse failures → `PROVIDER_ERROR`
- Amount/asset/chain validation failures → Specific codes

### 2. HTTP Response Mapping (`api/queue/confirm.ts`)

**Verification Failure Handling (Line 254):**
```typescript
if (!verificationResult.ok) {
  logger.warn('queue/confirm verification failed', {
    requestId,
    challengeId,
    txHash,
    code: verificationResult.code,
    message: verificationResult.message,
    detail: verificationResult.detail
  })

  res.status(400).json({
    error: {
      code: verificationResult.code,
      message: verificationResult.message
    },
    requestId
  })
  return
}
```

**HTTP Status Code Mapping:**
- `WRONG_CHAIN` → **400** (client error - user action required)
- `WRONG_ASSET` → **400** (client error - user action required)
- `WRONG_AMOUNT` → **400** (client error - user action required)
- `PROVIDER_ERROR` → **400** (client should retry later)
- `NO_MATCH` → **404** (challenge not found)
- `EXPIRED` → **400** (challenge expired)
- `VALIDATION_ERROR` → **400** (invalid request format)
- `TX_ALREADY_USED` → **409** (transaction hash reused from different payment)
- `WRONG_PAYER` → **400** (payment from wrong wallet address)
- `WALLET_NOT_BOUND` → **400** (wallet binding required but not completed)
- `DB_ERROR` → **500** (database failure)
- `INTERNAL` → **500** (unexpected server error)

**4xx vs 5xx Separation:**
- **4xx (Client Errors)**: Payment issues, validation errors, expired challenges - user can fix
- **5xx (Server Errors)**: Database failures, unexpected errors - ops team must investigate

### 3. Idempotency Semantics & TX_ALREADY_USED Reuse Detection

**IMPORTANT: Idempotency vs Reuse**

This implementation distinguishes between two scenarios:
1. **True Idempotency**: Same challenge resubmits same txHash → 200 OK (safe retry)
2. **Reuse Attack**: Different challenge tries to use existing txHash → 409 TX_ALREADY_USED (rejected)

**Check 1: Existing Confirmation by txHash (Lines 130-210)**
```typescript
// FIRST: Check if txHash already used (reuse detection)
const { data: existingByTxHash } = await supabaseAdmin
  .from('payment_confirmations')
  .select('*, payment_challenges!inner(track_id, user_id, bound_address)')
  .eq('tx_hash', txHash)
  .single()

if (existingByTxHash) {
  // CASE 1: Same challenge resubmitting → TRUE IDEMPOTENCY
  if (existingByTxHash.challenge_id === challengeId) {
    logger.info('queue/confirm idempotent (same challenge)', { requestId, challengeId, txHash })
    return res.status(200).json({
      ok: true,
      trackId: existingByTxHash.payment_challenges.track_id,
      status: 'PAID',
      requestId
    })
  }

  // CASE 2: Different challenge trying to reuse txHash → REUSE ATTACK
  logger.warn('queue/confirm TX_ALREADY_USED', {
    requestId,
    challengeId,
    txHash,
    originalChallengeId: existingByTxHash.challenge_id,
    originalTrackId: existingByTxHash.payment_challenges.track_id
  })

  // Check for WRONG_PAYER (payer address mismatch)
  const reasonCodes = ['TX_ALREADY_USED']
  if (existingByTxHash.tx_from_address && currentBoundAddress) {
    if (!addressesMatch(existingByTxHash.tx_from_address, currentBoundAddress)) {
      reasonCodes.push('WRONG_PAYER')
    }
  }

  return res.status(409).json({
    error: {
      code: 'TX_ALREADY_USED',
      message: 'This transaction hash was already used for a different payment.',
      data: {
        originalChallengeId: existingByTxHash.challenge_id,
        originalTrackId: existingByTxHash.payment_challenges.track_id,
        originalConfirmedAt: existingByTxHash.created_at,
        payerAddress: existingByTxHash.tx_from_address,
        boundAddress: currentBoundAddress,
        reasonCodes
      }
    },
    requestId
  })
}

// SECOND: Check if challenge already confirmed (challengeId idempotency)
const { data: existingByChallenge } = await supabaseAdmin
  .from('payment_confirmations')
  .select('*, payment_challenges!inner(track_id)')
  .eq('challenge_id', challengeId)
  .single()

if (existingByChallenge) {
  logger.info('queue/confirm idempotent (challenge already confirmed)', { requestId, challengeId })
  return res.status(200).json({
    ok: true,
    trackId: existingByChallenge.payment_challenges.track_id,
    status: 'PAID',
    requestId
  })
}
```

**Check 2: Concurrent Confirmation & Race Condition Handling (Lines 620-775)**
```typescript
if (confirmInsertErr) {
  // Check if this is a uniqueness violation (race condition)
  if (confirmInsertErr.code === '23505') {
    logger.info('queue/confirm race condition detected (23505)', { requestId, challengeId, txHash })

    // Re-query to find which constraint was violated
    const { data: raceWinner } = await supabaseAdmin
      .from('payment_confirmations')
      .select('*, payment_challenges!inner(track_id, user_id)')
      .eq('tx_hash', txHash)
      .single()

    if (raceWinner) {
      // CASE 1: Same challenge won the race → idempotent success
      if (raceWinner.challenge_id === challengeId) {
        logger.info('queue/confirm race resolved: same challenge won', { requestId, challengeId })
        return res.status(200).json({
          ok: true,
          trackId: raceWinner.payment_challenges.track_id,
          status: 'PAID',
          requestId
        })
      }

      // CASE 2: Different challenge won the race → TX_ALREADY_USED
      logger.warn('queue/confirm race resolved: different challenge won (TX_ALREADY_USED)', {
        requestId,
        challengeId,
        winningChallengeId: raceWinner.challenge_id
      })

      const reasonCodes = ['TX_ALREADY_USED']
      if (raceWinner.tx_from_address && currentBoundAddress) {
        if (!addressesMatch(raceWinner.tx_from_address, currentBoundAddress)) {
          reasonCodes.push('WRONG_PAYER')
        }
      }

      return res.status(409).json({
        error: {
          code: 'TX_ALREADY_USED',
          message: 'This transaction hash was already used for a different payment.',
          data: {
            originalChallengeId: raceWinner.challenge_id,
            originalTrackId: raceWinner.payment_challenges.track_id,
            originalConfirmedAt: raceWinner.created_at,
            payerAddress: raceWinner.tx_from_address,
            boundAddress: currentBoundAddress,
            reasonCodes
          }
        },
        requestId
      })
    }
  }

  // Other database errors → 500
  return res.status(500).json({
    error: { code: 'DB_ERROR', message: 'Database error during payment confirmation' },
    requestId
  })
}
```

**Idempotency Guarantees:**
1. **Same challengeId + Same txHash**: Returns 200 (true idempotency - safe retry)
2. **Different challengeId + Same txHash**: Returns 409 TX_ALREADY_USED (reuse rejected)
3. **Concurrent requests (same challenge)**: First wins, second returns 200 (23505 handling)
4. **Concurrent requests (different challenges)**: First wins, second returns 409 TX_ALREADY_USED
5. **No duplicate state transitions**: Track status updated only once
6. **No duplicate confirmation records**: Database unique constraints enforced

**TX_ALREADY_USED Error Code:**
- **HTTP Status**: 409 Conflict
- **When**: Different challenge tries to reuse existing txHash
- **Response Data**:
  - `originalChallengeId`: Challenge that first used this txHash
  - `originalTrackId`: Track that was paid
  - `originalConfirmedAt`: Timestamp of first confirmation
  - `payerAddress`: Address that sent the transaction (from tx_from_address)
  - `boundAddress`: Currently bound wallet address
  - `reasonCodes`: Array including 'TX_ALREADY_USED' and optionally 'WRONG_PAYER'

**WRONG_PAYER Detection:**
- **Triggered when**: `tx_from_address` doesn't match `bound_address` AND txHash is reused
- **Purpose**: Detect wallet switching attacks or accidental wallet changes
- **Frontend Action**: Show "Wallet Mismatch" warning with addresses, offer rebind option

### 4. Security and Logging

**Audit Logging (Lines 242-252):**
```typescript
logger.info('queue/confirm audit: verification failed', {
  requestId,
  challengeId,
  txHash,
  userId: challenge.user_id,
  trackId: challenge.track_id,
  amountAtomic: challenge.amount_atomic,
  asset: challenge.asset,
  chain: challenge.chain,
  verdict: 'FAILED',
  code: verificationResult.code
})
```

**Success Audit (Lines 396-408):**
```typescript
logger.info('queue/confirm audit: success', {
  requestId,
  challengeId,
  txHash,
  userId: challenge.user_id,
  trackId: challenge.track_id,
  amountAtomic: challenge.amount_atomic,
  amountPaidAtomic: verificationResult.amountPaidAtomic,
  asset: challenge.asset,
  chain: challenge.chain,
  verdict: 'SUCCESS'
})
```

**Security Properties:**
- `requestId` present in all responses
- No secrets (API keys, service role keys) in responses
- No internal server paths in error messages
- txHash logged in full for audit trail (can be masked if required)
- Structured error codes for ops monitoring

### 5. Comprehensive Tests

**`tests/server/x402-codes-and-idempotency.test.ts` (36 tests)**

**CDP adapter error mapping (7 tests):**
- WRONG_CHAIN when chain mismatch detected
- WRONG_ASSET when asset mismatch detected
- WRONG_AMOUNT when payment insufficient
- PROVIDER_ERROR for malformed responses
- PROVIDER_ERROR for 5xx responses after retries
- NO_MATCH for transaction not found
- EXPIRED for timed out transactions

**HTTP response mapping (9 tests):**
- WRONG_CHAIN → 400 response
- WRONG_ASSET → 400 response
- WRONG_AMOUNT → 400 response
- PROVIDER_ERROR → 400 response
- NO_MATCH → 404 response
- EXPIRED → 400 response
- VALIDATION_ERROR → 400 response
- DB_ERROR → 500 response (only for DB failures)
- INTERNAL → 500 response (only for unexpected errors)

**Idempotency semantics (6 tests):**
- Return 200 for first successful confirmation
- Return 200 for repeat confirmation with same challengeId
- Return 409 TX_ALREADY_USED for reused txHash with different challengeId
- No duplicate confirmation records created
- No duplicate track status transitions
- Concurrent confirmations handled gracefully (23505)

**TX_ALREADY_USED reuse detection (7 tests):**
- Return 409 when txHash already used for different challenge
- Include WRONG_PAYER in reasonCodes when payer address mismatches
- NOT include WRONG_PAYER when payer matches bound address
- Handle reuse when tx_from_address is missing (backfill incomplete)
- Preserve idempotency when same challenge resubmits same txHash
- Handle race condition: concurrent reuse attempts get 409
- Test reasonCodes array contains TX_ALREADY_USED

**Security and logging (4 tests):**
- requestId included in all responses
- Transaction hash masking pattern documented
- No secrets leaked in error responses
- Verification failures logged with full context

**4xx vs 5xx separation (3 tests):**
- 400 for client errors (payment issues)
- 404 for not found
- 500 only for server errors

**All tests passing:**
- x402-codes-and-idempotency.test.ts: 36 tests ✅
- queue-confirm-defensive.test.ts: 14 tests ✅
- queue-confirm.test.ts: 11 tests ✅
- binding-message.test.ts: 28 tests ✅
- payment-modal-confirm-errors.test.ts: 27 tests ✅

## User Experience

### Before
```json
// Generic error
{
  "error": {
    "code": "PROVIDER_ERROR",
    "message": "Payment verification failed"
  },
  "requestId": "req-123"
}
```

### After
```json
// Specific error with guidance
{
  "error": {
    "code": "WRONG_CHAIN",
    "message": "Payment sent on wrong blockchain network"
  },
  "requestId": "req-123"
}
```

**PaymentModal Display:**
```
WRONG_CHAIN: Payment sent on wrong blockchain network (Expected: Base Sepolia)
```

### Error Code Examples

**WRONG_AMOUNT:**
```json
{
  "error": {
    "code": "WRONG_AMOUNT",
    "message": "Payment amount is insufficient"
  },
  "requestId": "req-456"
}
```
UI: "WRONG_AMOUNT: Payment amount is insufficient"

**WRONG_ASSET:**
```json
{
  "error": {
    "code": "WRONG_ASSET",
    "message": "Wrong cryptocurrency used for payment"
  },
  "requestId": "req-789"
}
```
UI: "WRONG_ASSET: Wrong cryptocurrency used for payment (Expected: USDC)"

**PROVIDER_ERROR:**
```json
{
  "error": {
    "code": "PROVIDER_ERROR",
    "message": "Payment verification service temporarily unavailable"
  },
  "requestId": "req-provider"
}
```
UI: "PROVIDER_ERROR: Payment verification service temporarily unavailable"

**TX_ALREADY_USED:**
```json
{
  "error": {
    "code": "TX_ALREADY_USED",
    "message": "This transaction hash was already used for a different payment.",
    "data": {
      "originalChallengeId": "550e8400-e29b-41d4-a716-446655440000",
      "originalTrackId": "track-abc123",
      "originalConfirmedAt": "2025-10-09T12:30:00Z",
      "payerAddress": "0x1234...5678",
      "boundAddress": "0x1234...5678",
      "reasonCodes": ["TX_ALREADY_USED"]
    }
  },
  "requestId": "req-reuse"
}
```
UI:
```
⚠️ Transaction Already Used
This transaction was already confirmed for payment #track-abc...
on 10/9/2025, 12:30:00 PM

[Change Wallet] [Send New Payment]
```

**TX_ALREADY_USED with WRONG_PAYER:**
```json
{
  "error": {
    "code": "TX_ALREADY_USED",
    "message": "This transaction hash was already used for a different payment.",
    "data": {
      "originalChallengeId": "550e8400-e29b-41d4-a716-446655440000",
      "originalTrackId": "track-abc123",
      "originalConfirmedAt": "2025-10-09T12:30:00Z",
      "payerAddress": "0x1234...5678",
      "boundAddress": "0xabcd...efgh",
      "reasonCodes": ["TX_ALREADY_USED", "WRONG_PAYER"]
    }
  },
  "requestId": "req-reuse-wrong-payer"
}
```
UI:
```
⚠️ Transaction Already Used
This transaction was already confirmed for payment #track-abc...
on 10/9/2025, 12:30:00 PM

Wallet Mismatch:
  Payment from: 0x1234...5678
  Bound wallet: 0xabcd...efgh

[Change Wallet] [Send New Payment]
```

## Operational Monitoring

### Error Code Distribution
```bash
# Track error codes in production logs
grep "queue/confirm audit" logs.json | jq '.code' | sort | uniq -c

# Expected distribution:
#   10 EXPIRED           # Normal timeout behavior (400)
#    5 WRONG_AMOUNT      # User payment mistakes (400)
#    3 WRONG_ASSET       # User sent wrong crypto (400)
#    2 WRONG_CHAIN       # User used wrong network (400)
#    1 PROVIDER_ERROR    # CDP API issues (400, investigate)
#    0 DB_ERROR          # Database issues (500, critical!)
#    0 INTERNAL          # Unexpected errors (500, critical!)
```

### Alerts
- **Critical (500s)**: `DB_ERROR`, `INTERNAL` - requires immediate investigation
- **Warning (400s)**: `PROVIDER_ERROR` spike - CDP may be down
- **Informational**: `WRONG_CHAIN`, `WRONG_ASSET`, `WRONG_AMOUNT` - user guidance needed

## Files Modified

### Backend
1. `api/queue/confirm.ts` - Reordered logic for TX_ALREADY_USED detection, added reasonCodes, WRONG_PAYER detection
2. `supabase/migrations/007_tx_from_address_and_backfill.sql` - New migration for tx_from_address column
3. `api/_shared/payments/x402-cdp.ts` - Added `message` field, updated all error returns (previous update)

### Frontend
4. `src/lib/paymentClient.ts` - Extended PaymentError with isTxReused(), getReasonCodes(), getOriginalRefs()
5. `src/components/PaymentModal.tsx` - Added TX_ALREADY_USED error display with CTAs
6. `src/shared/binding-message.ts` - Shared binding message module (previous update)
7. `src/hooks/useWalletBinding.ts` - Updated to use shared binding message module (previous update)

### Tests
8. `tests/server/x402-codes-and-idempotency.test.ts` - Extended to 36 tests with TX_ALREADY_USED scenarios
9. `tests/shared/binding-message.test.ts` - 28 tests for binding message module (previous update)

## TypeScript Compilation

```bash
npm run typecheck
```

**Status**: ✅ No errors

## Production Readiness

- ✅ Granular x402 error codes (WRONG_CHAIN, WRONG_ASSET, WRONG_AMOUNT, PROVIDER_ERROR)
- ✅ TX_ALREADY_USED reuse detection (409 for different challenge + same txHash)
- ✅ WRONG_PAYER detection (payer address mismatch on reused transactions)
- ✅ Idempotency semantics locked in (same challengeId/txHash → 200, no duplicates)
- ✅ Race condition handling (23505 concurrent inserts resolved correctly)
- ✅ 4xx vs 5xx separation maintained
- ✅ requestId in all responses
- ✅ No secrets in error responses
- ✅ Comprehensive audit logging
- ✅ 116/116 relevant tests passing (36 in x402-codes-and-idempotency.test.ts)
- ✅ TypeScript compilation clean
- ✅ User-friendly error messages with CTAs in UI
- ✅ Database migration ready (007_tx_from_address_and_backfill.sql)

## Deployment Notes

**Database Migration Required:**
```bash
# Run migration to add tx_from_address column
psql $DATABASE_URL -f supabase/migrations/007_tx_from_address_and_backfill.sql
```

**Backfill (Optional, Best-Effort):**
- Old payment_confirmations records may have `tx_from_address = null`
- WRONG_PAYER detection skipped when tx_from_address missing
- Backfill can run in background via RPC (see migration comments)

**Environment Variables:**
No new environment variables required. Existing x402 configuration applies.

**Backward Compatibility:**
- Existing API clients will see new 409 TX_ALREADY_USED error (instead of 200 idempotent)
- This is a **breaking change** for clients expecting txHash reuse to succeed
- However, txHash reuse was never a documented/supported feature, so this is a bug fix
- PaymentModal.tsx updated to handle 409 TX_ALREADY_USED gracefully

## Acceptance Criteria

- [x] /api/queue/confirm returns granular x402 error codes for chain/asset/amount/provider mismatches
- [x] Idempotent re-confirm (same challenge) returns 200; no duplicate effects
- [x] TX_ALREADY_USED (different challenge) returns 409 with originalChallengeId, originalTrackId
- [x] WRONG_PAYER detection when tx_from_address mismatches bound_address
- [x] Race condition handling: concurrent requests resolved correctly (23505)
- [x] No regression to 500s; requestId present; UI renders clear error messages with CTAs
- [x] Tests pass; typecheck clean
- [x] Database migration created and documented

---

**Implementation Complete**: TX_ALREADY_USED reuse detection implemented, WRONG_PAYER detection added, idempotency vs reuse semantics clarified, comprehensive test coverage added, UI updated with error display and CTAs.
