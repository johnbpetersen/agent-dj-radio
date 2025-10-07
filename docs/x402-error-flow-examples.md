# x402 Error Flow Examples

This document shows complete end-to-end flows for each error code in the x402 payment verification system.

## Success Flow

### Request
```bash
curl -X POST http://localhost:3001/api/queue/confirm \
  -H 'Content-Type: application/json' \
  -d '{
    "challengeId": "550e8400-e29b-41d4-a716-446655440000",
    "txHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
  }'
```

### CDP Response
```json
{
  "verified": true,
  "amountPaid": 1000000,
  "asset": "USDC",
  "chain": "base-sepolia"
}
```

### Server Log
```json
{
  "level": "info",
  "msg": "queue/confirm audit: success",
  "requestId": "req-abc123",
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "txHash": "0xabcdef...",
  "userId": "user-123",
  "trackId": "track-456",
  "amountAtomic": 1000000,
  "amountPaidAtomic": 1000000,
  "asset": "USDC",
  "chain": "base-sepolia",
  "verdict": "SUCCESS"
}
```

### HTTP Response (200)
```json
{
  "ok": true,
  "trackId": "track-456",
  "status": "PAID",
  "requestId": "req-abc123"
}
```

### UI Display
```
✅ Payment verified! Your track is now in the queue.
```

---

## WRONG_CHAIN Flow

### Scenario
User sent payment on Ethereum Mainnet instead of Base Sepolia.

### CDP Response
```json
{
  "verified": false,
  "chain": "ethereum-mainnet",
  "error": {
    "code": "CHAIN_MISMATCH",
    "message": "Transaction is on wrong chain"
  }
}
```

### Adapter Result
```typescript
{
  ok: false,
  code: 'WRONG_CHAIN',
  message: 'Payment sent on wrong blockchain network',
  detail: 'Expected base-sepolia, got ethereum-mainnet'
}
```

### Server Log
```json
{
  "level": "warn",
  "msg": "queue/confirm verification failed",
  "requestId": "req-xyz789",
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "txHash": "0xabcdef...",
  "code": "WRONG_CHAIN",
  "message": "Payment sent on wrong blockchain network",
  "detail": "Expected base-sepolia, got ethereum-mainnet"
}
```

### HTTP Response (400)
```json
{
  "error": {
    "code": "WRONG_CHAIN",
    "message": "Payment sent on wrong blockchain network"
  },
  "requestId": "req-xyz789"
}
```

### UI Display
```
❌ WRONG_CHAIN: Payment sent on wrong blockchain network (Expected: Base Sepolia)
```

**User Action**: Switch wallet to Base Sepolia network and retry payment.

---

## WRONG_ASSET Flow

### Scenario
User sent ETH instead of USDC.

### CDP Response
```json
{
  "verified": false,
  "asset": "ETH",
  "error": {
    "code": "ASSET_MISMATCH",
    "message": "Wrong token sent"
  }
}
```

### Adapter Result
```typescript
{
  ok: false,
  code: 'WRONG_ASSET',
  message: 'Wrong cryptocurrency used for payment',
  detail: 'Expected USDC, got ETH'
}
```

### Server Log
```json
{
  "level": "warn",
  "msg": "queue/confirm verification failed",
  "requestId": "req-def456",
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "txHash": "0xabcdef...",
  "code": "WRONG_ASSET",
  "message": "Wrong cryptocurrency used for payment",
  "detail": "Expected USDC, got ETH"
}
```

### HTTP Response (400)
```json
{
  "error": {
    "code": "WRONG_ASSET",
    "message": "Wrong cryptocurrency used for payment"
  },
  "requestId": "req-def456"
}
```

### UI Display
```
❌ WRONG_ASSET: Wrong cryptocurrency used for payment (Expected: USDC)
```

**User Action**: Send USDC instead of ETH.

---

## WRONG_AMOUNT Flow

### Scenario
User sent 0.5 USDC when 1 USDC was required.

### CDP Response
```json
{
  "verified": false,
  "amountPaid": 500000,
  "error": {
    "code": "INSUFFICIENT_AMOUNT",
    "message": "Amount too low"
  }
}
```

### Adapter Result
```typescript
{
  ok: false,
  code: 'WRONG_AMOUNT',
  message: 'Payment amount is insufficient',
  detail: 'Insufficient payment: expected 1000000, got 500000 (short by 500000)'
}
```

### Server Log
```json
{
  "level": "warn",
  "msg": "queue/confirm verification failed",
  "requestId": "req-ghi789",
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "txHash": "0xabcdef...",
  "code": "WRONG_AMOUNT",
  "message": "Payment amount is insufficient",
  "detail": "Insufficient payment: expected 1000000, got 500000 (short by 500000)"
}
```

### HTTP Response (400)
```json
{
  "error": {
    "code": "WRONG_AMOUNT",
    "message": "Payment amount is insufficient"
  },
  "requestId": "req-ghi789"
}
```

### UI Display
```
❌ WRONG_AMOUNT: Payment amount is insufficient
```

**User Action**: Send the full required amount (1 USDC in this case).

---

## NO_MATCH Flow

### Scenario
Transaction hash not found on blockchain (typo or wrong network).

### CDP Response
```json
{
  "verified": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Transaction hash not found on chain"
  }
}
```

### Adapter Result
```typescript
{
  ok: false,
  code: 'NO_MATCH',
  message: 'Transaction not found on blockchain',
  detail: 'Transaction hash not found on chain'
}
```

### HTTP Response (404)
```json
{
  "error": {
    "code": "NO_MATCH",
    "message": "Payment challenge not found"
  },
  "requestId": "req-jkl012"
}
```

### UI Display
```
❌ NO_MATCH: Transaction not found on blockchain (Check transaction hash)
```

**User Action**: Verify transaction hash is correct, check correct network.

---

## EXPIRED Flow

### Scenario
Payment challenge expired after 5 minutes.

### Server Check (Before CDP)
```typescript
const now = Date.now()
const expiresAt = new Date(challenge.expires_at).getTime()
if (now > expiresAt + CLOCK_SKEW_MS) {
  res.status(400).json({
    error: {
      code: 'EXPIRED',
      message: 'Payment challenge has expired. Please refresh and try again.'
    },
    requestId
  })
  return
}
```

### HTTP Response (400)
```json
{
  "error": {
    "code": "EXPIRED",
    "message": "Payment challenge has expired. Please refresh and try again."
  },
  "requestId": "req-mno345"
}
```

### UI Display
```
❌ EXPIRED: Payment challenge has expired. Please refresh and try again.
[Refresh Challenge] button shown
```

**User Action**: Click "Refresh Challenge" to get a new payment challenge.

---

## PROVIDER_ERROR Flow

### Scenario
CDP API is down (503 after retries).

### CDP Response (After 3 Retries)
```
HTTP 503 Service Unavailable
```

### Adapter Result
```typescript
{
  ok: false,
  code: 'PROVIDER_ERROR',
  message: 'Payment verification service temporarily unavailable',
  detail: 'Provider unavailable after 3 attempts: CDP returned 503: Service Unavailable'
}
```

### Server Log
```json
{
  "level": "error",
  "msg": "CDP verification failed after all retries",
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "txHash": "0xabcdef...",
  "attempts": 3,
  "lastError": "CDP returned 503: Service Unavailable"
}
```

### HTTP Response (400)
```json
{
  "error": {
    "code": "PROVIDER_ERROR",
    "message": "Payment verification service temporarily unavailable"
  },
  "requestId": "req-pqr678"
}
```

### UI Display
```
❌ PROVIDER_ERROR: Payment verification service temporarily unavailable
```

**User Action**: Wait a few minutes and retry. Payment is valid but verification service is down.

---

## DB_ERROR Flow (500)

### Scenario
Database connection lost during confirmation check.

### Supabase Error
```typescript
{
  code: 'PGRST301',
  message: 'connection to server failed'
}
```

### Server Response
```typescript
if (confirmCheckErr && confirmCheckErr.code !== 'PGRST116') {
  res.status(500).json({
    error: {
      code: 'DB_ERROR',
      message: 'Database error while checking payment status'
    },
    requestId
  })
  return
}
```

### HTTP Response (500)
```json
{
  "error": {
    "code": "DB_ERROR",
    "message": "Database error while checking payment status"
  },
  "requestId": "req-stu901"
}
```

### UI Display
```
❌ DB_ERROR: Database error while checking payment status (Database error - please try again)
```

### Ops Alert
```
🚨 CRITICAL: DB_ERROR in queue/confirm
RequestId: req-stu901
Action: Check Supabase connection, investigate database health
```

---

## INTERNAL Flow (500)

### Scenario
Unexpected error in handler (e.g., undefined variable access).

### Server Error
```typescript
catch (error) {
  const err = error instanceof Error ? error : new Error(String(error))
  errorTracker.trackError(err, { operation: 'queue/confirm', requestId })

  if (!res.headersSent) {
    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'Internal server error during payment confirmation'
      },
      requestId
    })
  }
}
```

### HTTP Response (500)
```json
{
  "error": {
    "code": "INTERNAL",
    "message": "Internal server error during payment confirmation"
  },
  "requestId": "req-vwx234"
}
```

### UI Display
```
❌ INTERNAL: Internal server error during payment confirmation (Server error - please contact support)
```

### Ops Alert
```
🚨 CRITICAL: INTERNAL error in queue/confirm
RequestId: req-vwx234
Error: TypeError: Cannot read properties of undefined
Stack: [full stack trace]
Action: Investigate immediately, possible code bug
```

---

## Idempotency Flow

### First Request
```bash
curl -X POST http://localhost:3001/api/queue/confirm \
  -H 'Content-Type: application/json' \
  -d '{
    "challengeId": "550e8400-e29b-41d4-a716-446655440000",
    "txHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
  }'
```

**Response (200):**
```json
{
  "ok": true,
  "trackId": "track-456",
  "status": "PAID",
  "requestId": "req-first"
}
```

**Database:**
- 1 row inserted into `payment_confirmations`
- 1 track updated to `PAID` status

### Second Request (Same challengeId + txHash)
```bash
curl -X POST http://localhost:3001/api/queue/confirm \
  -H 'Content-Type: application/json' \
  -d '{
    "challengeId": "550e8400-e29b-41d4-a716-446655440000",
    "txHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
  }'
```

**Server Logic:**
```typescript
// Check for existing confirmation
const { data: existingConfirmation } = await supabaseAdmin
  .from('payment_confirmations')
  .select('*, payment_challenges!inner(track_id, user_id)')
  .or(`challenge_id.eq.${challengeId},tx_hash.eq.${txHash}`)
  .single()

if (existingConfirmation) {
  // Idempotent response - no duplicate effects
  return res.status(200).json({
    ok: true,
    trackId: existingConfirmation.payment_challenges.track_id,
    status: 'PAID',
    requestId
  })
}
```

**Response (200):**
```json
{
  "ok": true,
  "trackId": "track-456",
  "status": "PAID",
  "requestId": "req-second"
}
```

**Database:**
- Still only 1 row in `payment_confirmations`
- Track still `PAID` (no UPDATE query run)

**Server Log:**
```json
{
  "level": "info",
  "msg": "queue/confirm idempotent (already confirmed)",
  "requestId": "req-second",
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "txHash": "0xabcdef...",
  "trackId": "track-456",
  "existingConfirmationId": "conf-123"
}
```

---

## Concurrent Confirmation Flow

### Scenario
Two requests arrive simultaneously with same challengeId + txHash.

### Request 1 & Request 2 (Simultaneous)
```bash
# Terminal 1
curl -X POST http://localhost:3001/api/queue/confirm -d '{"challengeId":"...","txHash":"..."}'

# Terminal 2 (same millisecond)
curl -X POST http://localhost:3001/api/queue/confirm -d '{"challengeId":"...","txHash":"..."}'
```

### Server Processing

**Request 1 (wins race):**
```typescript
// Check for existing - none found
// Insert confirmation - SUCCESS
await supabaseAdmin.from('payment_confirmations').insert({
  challenge_id: challengeId,
  tx_hash: txHash,
  ...
})

// Returns 200
```

**Request 2 (loses race):**
```typescript
// Check for existing - none found (race condition)
// Insert confirmation - FAILS with 23505 (unique constraint)

if (confirmInsertErr.code === '23505') {
  // Re-query to get the confirmation that Request 1 created
  const { data: existing } = await supabaseAdmin
    .from('payment_confirmations')
    .select('*, payment_challenges!inner(track_id)')
    .eq('challenge_id', challengeId)
    .single()

  // Returns 200 with existing confirmation
  return res.status(200).json({
    ok: true,
    trackId: existing.payment_challenges.track_id,
    status: 'PAID',
    requestId
  })
}
```

### Both Responses (200)
```json
{
  "ok": true,
  "trackId": "track-456",
  "status": "PAID",
  "requestId": "req-1" // or "req-2"
}
```

### Database
- Only 1 row in `payment_confirmations` (unique constraint enforced)
- Track updated once to `PAID` status

---

## Monitoring Queries

### Count Error Codes (Last Hour)
```bash
grep "queue/confirm audit" logs.json \
  | jq -r 'select(.timestamp > now - 3600) | .code' \
  | sort | uniq -c | sort -rn
```

**Example Output:**
```
  45 (no code)         # Successful confirmations
  10 EXPIRED
   5 WRONG_AMOUNT
   3 WRONG_ASSET
   2 WRONG_CHAIN
   1 PROVIDER_ERROR
   0 DB_ERROR           # Good!
   0 INTERNAL           # Good!
```

### Alert Triggers
```yaml
# Datadog/Prometheus alerts
- alert: CDP_Provider_Down
  expr: rate(queue_confirm_errors{code="PROVIDER_ERROR"}[5m]) > 0.1
  severity: warning
  message: "CDP API may be experiencing issues"

- alert: Database_Errors
  expr: rate(queue_confirm_errors{code="DB_ERROR"}[5m]) > 0
  severity: critical
  message: "Database errors in payment confirmation - investigate immediately"

- alert: Internal_Errors
  expr: rate(queue_confirm_errors{code="INTERNAL"}[5m]) > 0
  severity: critical
  message: "Unexpected errors in payment confirmation - possible code bug"
```

---

## Summary

| Error Code | Status | Retryable | User Action |
|------------|--------|-----------|-------------|
| SUCCESS | 200 | N/A | Track queued |
| WRONG_CHAIN | 400 | Yes | Switch network |
| WRONG_ASSET | 400 | Yes | Send correct crypto |
| WRONG_AMOUNT | 400 | Yes | Send correct amount |
| NO_MATCH | 404 | Yes | Verify tx hash |
| EXPIRED | 400 | Yes | Refresh challenge |
| PROVIDER_ERROR | 400 | Yes | Wait and retry |
| DB_ERROR | 500 | Yes | Retry later |
| INTERNAL | 500 | Maybe | Contact support |

**Idempotency**: All repeat confirmations return 200 with no duplicate effects.
