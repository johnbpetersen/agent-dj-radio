# Facilitator Payload Analysis & Debugging

## Current Problem
Getting "Payment verification service temporarily unavailable" errors when calling the x402 facilitator `/verify` endpoint.

## Payload Variant Comparison Matrix

| Field | Spec Requirement | Variant A (Canonical) | Variant B (Compat) | Variant C (Legacy) | Status |
|-------|-----------------|---------------------|-------------------|-------------------|---------|
| **scheme** | `"erc3009"` (string) | ✅ `"erc3009"` | ✅ `"erc3009"` | ✅ `"erc3009"` | MATCH |
| **chainId** | `number` | ✅ `number` | ❌ `string` | ❌ `string` | **MISMATCH B/C** |
| **tokenAddress** | lowercase hex | ✅ lowercase | ✅ lowercase | ❌ **MISSING** | **ERROR C** |
| **payTo** | lowercase hex | ✅ lowercase | ✅ lowercase | ❌ **MISSING** | **ERROR C** |
| **amountAtomic** | decimal string | ✅ decimal string | ✅ decimal string | ❌ **MISSING** | **ERROR C** |
| **chain** | N/A (not in spec) | ❌ not present | ❌ not present | ⚠️  present (extra) | EXTRA C |
| **asset** | N/A (not in spec) | ❌ not present | ❌ not present | ⚠️  present (extra) | EXTRA C |
| **token** | N/A (not in spec) | ❌ not present | ❌ not present | ⚠️  present (instead of tokenAddress) | **ERROR C** |
| **recipient** | N/A (not in spec) | ❌ not present | ❌ not present | ⚠️  present (instead of payTo) | **ERROR C** |
| **amount** | N/A (not in spec) | ❌ not present | ❌ not present | ⚠️  present (instead of amountAtomic) | **ERROR C** |
| **signature** (top-level) | N/A (should be in auth) | ❌ not present | ⚠️  present (duplicate) | ⚠️  present (duplicate) | EXTRA B/C |
| **authorization.from** | lowercase hex | ✅ lowercase | ✅ lowercase | ✅ lowercase | MATCH |
| **authorization.to** | lowercase hex | ✅ lowercase | ✅ lowercase | ✅ lowercase | MATCH |
| **authorization.value** | decimal string | ✅ decimal string | ✅ decimal string | ✅ decimal string | MATCH |
| **authorization.validAfter** | decimal string | ✅ decimal string | ✅ decimal string | ✅ decimal string | MATCH |
| **authorization.validBefore** | decimal string | ✅ decimal string | ✅ decimal string | ✅ decimal string | MATCH |
| **authorization.nonce** | lowercase hex (66 chars) | ✅ lowercase 66 | ✅ lowercase 66 | ✅ lowercase 66 | MATCH |
| **authorization.signature** | lowercase hex (132 chars) | ✅ lowercase 132 | ✅ lowercase 132 | ✅ lowercase 132 | MATCH |

## Analysis Results

### Variant A: Canonical ✅ **CORRECT**
**Status**: Matches spec exactly

**Strengths**:
- ✅ `chainId` as number (required by spec)
- ✅ All required top-level fields present
- ✅ No extra/wrong fields
- ✅ All hex values lowercase
- ✅ All numeric values as decimal strings
- ✅ Signature inside authorization only (clean structure)

**Recommendation**: **USE THIS AS PRIMARY VARIANT**

### Variant B: Compat ⚠️ **LIKELY FAILS**
**Status**: Has critical mismatch

**Issues**:
- ❌ `chainId` as string instead of number
- ⚠️  Duplicate signature at top level (not in spec)

**Why it might work**: Some facilitators may accept string chainId
**Why it probably fails**: Spec clearly requires number

**Recommendation**: **KEEP AS FALLBACK ONLY** (try after canonical fails with 400/422)

### Variant C: Legacy ❌ **DEFINITELY FAILS**
**Status**: Wrong schema entirely

**Critical errors**:
- ❌ Missing `tokenAddress` (uses `token` instead)
- ❌ Missing `payTo` (uses `recipient` instead)
- ❌ Missing `amountAtomic` (uses `amount` instead)
- ❌ `chainId` as string instead of number
- ⚠️  Extra fields: `chain`, `asset`

**Why it fails**: Uses completely different field names not in spec

**Recommendation**: **REMOVE THIS VARIANT** (will always fail against standard facilitator)

## Likely Root Cause

Based on the analysis, the most likely issues are:

1. **Variant C is being tried and always fails** (wrong schema)
2. **Variant B fails due to string chainId** (type mismatch)
3. **Variant A might not be reached** if we stop after B/C fail with 4xx

### Current Variant Order
```typescript
const variants = [
  { name: 'canonical', builder: buildCanonical },   // ✅ Should work
  { name: 'compat', builder: buildCompat },         // ❌ Probably fails (string chainId)
  { name: 'legacy', builder: buildLegacy }          // ❌ Definitely fails (wrong schema)
]
```

### Problem
If variants B and C return 400/422 errors, and our retry logic stops on 4xx (except 404/405), we might never reach variant A, or we exhaust all variants and return 503.

## Recommended Fix

### Option 1: Use Only Canonical (Simplest)
```typescript
const variants = [
  { name: 'canonical', builder: buildCanonical }
]
```

**Pros**: Clean, matches spec, should work
**Cons**: No fallback if facilitator has quirks

### Option 2: Canonical First, Then Minimal Fallbacks
```typescript
const variants = [
  { name: 'canonical', builder: buildCanonical },   // Primary (number chainId)
  { name: 'compat', builder: buildCompat }          // Fallback (string chainId)
  // Remove legacy variant entirely
]
```

**Pros**: Tries spec-compliant first, has fallback for quirky facilitators
**Cons**: Still tries compat which might fail

### Option 3: Fix Variant B to Match Spec
Update buildCompat to also use number chainId:
```typescript
export function buildCompat(params: PayloadParams) {
  // ...
  return {
    scheme: 'erc3009' as const,
    chainId: params.chainId,  // ✅ Use number, not String(params.chainId)
    // ... rest stays same
  }
}
```

Then buildCompat becomes "canonical + duplicate signature" for facilitators that expect signature at top level.

## Next Steps

### Immediate Actions

1. **Remove Legacy Variant** - It will never work with standard facilitator
   ```typescript
   // DELETE buildLegacy from variants.ts
   // REMOVE from variants array in index.ts
   ```

2. **Fix Compat Variant** - Make chainId a number
   ```diff
   - chainId: String(params.chainId),
   + chainId: params.chainId,
   ```

3. **Reorder Variants** - Canonical first
   ```typescript
   const variants = [
     { name: 'canonical', builder: buildCanonical },
     { name: 'compat', builder: buildCompat }  // Only if signature-at-top-level is needed
   ]
   ```

4. **Add Detailed Logging** - Already done in recent patches

5. **Test with Real Facilitator**
   ```bash
   # Use canonical payload
   curl -X POST https://x402.org/facilitator/verify \
     -H "Content-Type: application/json" \
     -H "Accept: application/json" \
     -d '{ ... canonical payload ... }'
   ```

### Diagnostic Commands

Test each variant independently:

#### Test Canonical (should work)
```bash
cat > canonical.json <<'EOF'
{
  "scheme": "erc3009",
  "chainId": 84532,
  "tokenAddress": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  "payTo": "0x1234567890123456789012345678901234567890",
  "amountAtomic": "10000",
  "authorization": {
    "from": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "to": "0x1234567890123456789012345678901234567890",
    "value": "10000",
    "validAfter": "1740672089",
    "validBefore": "9999999999",
    "nonce": "0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480",
    "signature": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
  }
}
EOF

curl -X POST https://x402.org/facilitator/verify \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "User-Agent: agent-dj-radio/1.0 (+x402)" \
  -d @canonical.json \
  -v
```

#### Test Compat (probably fails - string chainId)
```bash
cat > compat.json <<'EOF'
{
  "scheme": "erc3009",
  "chainId": "84532",
  "tokenAddress": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  "payTo": "0x1234567890123456789012345678901234567890",
  "amountAtomic": "10000",
  "signature": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12",
  "authorization": {
    "from": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "to": "0x1234567890123456789012345678901234567890",
    "value": "10000",
    "validAfter": "1740672089",
    "validBefore": "9999999999",
    "nonce": "0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480"
  }
}
EOF

curl -X POST https://x402.org/facilitator/verify \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d @compat.json \
  -v
```

#### Test Legacy (will definitely fail - wrong field names)
```bash
cat > legacy.json <<'EOF'
{
  "scheme": "erc3009",
  "chain": "base-sepolia",
  "asset": "usdc",
  "token": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  "recipient": "0x1234567890123456789012345678901234567890",
  "amount": "10000",
  "chainId": "84532",
  "signature": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12",
  "authorization": {
    "from": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "to": "0x1234567890123456789012345678901234567890",
    "value": "10000",
    "validAfter": "1740672089",
    "validBefore": "9999999999",
    "nonce": "0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480"
  }
}
EOF

curl -X POST https://x402.org/facilitator/verify \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d @legacy.json \
  -v
```

## Expected Outcomes

### If Canonical Works (200 OK)
- ✅ Service is up
- ✅ Our payload is correct
- ✅ Remove other variants
- ✅ Problem solved!

### If Canonical Fails with 400/422
- ❌ Our payload has validation errors
- 🔍 Check response body for specific error
- 🔍 Verify signature is valid (might need real signature, not dummy)
- 🔍 Check if validBefore is actually in the future
- 🔍 Verify nonce hasn't been used before

### If All Fail with 503/504/Timeout
- ❌ Facilitator service is actually down
- ✅ Our error handling is correct
- ✅ Show "service temporarily unavailable" to user

### If We Get 404/405
- ❌ URL path is wrong
- 🔍 Check that URL is `https://x402.org/facilitator/verify`
- 🔍 Not `/facilitator/facilitator/verify` or just `/verify`

## Conclusion

**Primary Issue**: Variant C (legacy) is definitely wrong and will always fail. Variant B (compat) probably fails due to string chainId. We should use Variant A (canonical) as primary and potentially remove the others entirely.

**Recommended Action**:
1. Remove buildLegacy variant
2. Fix buildCompat to use number chainId
3. Try canonical variant first
4. Test with real facilitator endpoint to confirm
