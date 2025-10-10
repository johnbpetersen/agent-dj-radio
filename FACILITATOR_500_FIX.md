# Facilitator 500 Error - Root Cause & Solution

## Problem

Getting "Payment verification service temporarily unavailable" errors when calling the x402 facilitator API. Both canonical and compat payload variants were failing with HTTP 500 and empty response body.

## Root Cause Identified ✅

**The facilitator URL was returning a 308 Permanent Redirect:**

```
https://x402.org/facilitator/verify  →  308 Redirect  →  https://www.x402.org/facilitator/verify
```

**Issue**: Node.js `fetch()` was NOT automatically following the redirect, causing our code to receive a 308 response which was being mishandled as a 500 error.

### Evidence

```bash
$ curl -v https://x402.org/facilitator/verify
< HTTP/2 308
< location: https://www.x402.org/facilitator/verify
< refresh: 0;url=https://www.x402.org/facilitator/verify
```

The server redirects from `x402.org` to `www.x402.org`, but our fetch call wasn't following it.

## Solution Applied ✅

### Code Fix (transport.ts)

Added `redirect: 'follow'` option to the fetch call:

```typescript
const res = await fetch(url, {
  method: 'POST',
  headers: { /* ... */ },
  body: JSON.stringify(payload),
  signal: controller.signal,
  redirect: 'follow' // ← Added this line
})
```

**File changed**: `api/_shared/payments/facilitator/transport.ts` (line 44)

### Environment Variable Update (Recommended)

Update `.env.local` to use the correct URL directly:

```bash
# Old (causes redirect):
X402_FACILITATOR_URL=https://x402.org/facilitator

# New (direct, no redirect):
X402_FACILITATOR_URL=https://www.x402.org/facilitator
```

**Benefits of updating the env var:**
- Faster requests (no redirect hop)
- Clearer logs (shows actual URL being used)
- Avoids potential redirect loop issues

## Additional Improvements

### 1. Payload Debugging

Added detailed payload logging for first attempt:

```typescript
console.log('[x402-facilitator] payload preview:', {
  scheme: payload.scheme,
  chainId: payload.chainId,
  chainIdType: typeof payload.chainId,
  tokenAddress: payload.tokenAddress?.substring(0, 10) + '...',
  amountAtomic: payload.amountAtomic,
  authSigLen: payload.authorization?.signature?.length,
  // ... etc
})
```

This helps diagnose payload issues without exposing full signatures/addresses.

### 2. Leading Zero Normalization

Fixed all variants to strip leading zeros from `amountAtomic`:

```typescript
amountAtomic: asDecString(params.amountAtomic) // Strip leading zeros
```

**Before**: `"0010000"` (invalid)
**After**: `"10000"` (valid)

### 3. Variant Cleanup

- **Variant A (Canonical)**: ✅ Matches spec exactly (number chainId, correct fields)
- **Variant B (Compat)**: ✅ Fixed to use number chainId (was string)
- **Variant C (Legacy)**: ⚠️ Deprecated and removed from active use (wrong field names)

## Testing

### Quick Test

Run the test script to verify redirect handling:

```bash
./test-facilitator.sh
```

Should now see a 200 or 4xx response (validation error) instead of 308 redirect.

### Expected Behavior After Fix

1. **With code fix only** (redirect: 'follow'):
   - Fetch automatically follows 308 redirect
   - Request hits `https://www.x402.org/facilitator/verify`
   - Gets proper 200/400/422 response

2. **With env var update + code fix**:
   - No redirect needed
   - Direct request to `https://www.x402.org/facilitator/verify`
   - Faster response, cleaner logs

## Deployment Checklist

- [x] Code changes committed (transport.ts, index.ts, variants.ts)
- [x] TypeScript compilation passes
- [x] Unit tests pass (variants.test.ts)
- [ ] Update `.env.local` with correct facilitator URL
- [ ] Restart dev server to pick up env changes
- [ ] Test real payment flow end-to-end

## What Was NOT the Issue

❌ Payload structure (canonical variant already matched spec)
❌ Signature format (correct length, lowercase)
❌ Timestamp validation (validAfter/validBefore were correct)
❌ Amount normalization (BigInt already strips leading zeros)
✅ **URL redirect not being followed by fetch()**

## Summary

The 500 errors were caused by a simple infrastructure issue: the facilitator URL was redirecting, but our HTTP client wasn't following redirects. The fix is one line: `redirect: 'follow'`.

All other improvements (payload normalization, variant cleanup, logging) are valuable hardening, but the redirect issue was the root cause of the 500 errors.
