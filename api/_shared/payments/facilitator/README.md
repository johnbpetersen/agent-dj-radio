# x402 Facilitator API Specification

## Overview
The x402 facilitator provides payment verification for ERC-3009 (EIP-3009) transferWithAuthorization flows. This allows gasless token transfers where the payer signs an authorization that the facilitator submits on-chain.

## Endpoint

### POST `/verify`

**Full URL**: `{facilitatorBaseUrl}/verify`

Example: `https://x402.org/facilitator/verify`

**Note**: The path is `/verify`, NOT `/facilitator/verify`. The base URL should already include `/facilitator` if needed.

## Request Schema

### ERC-3009 Authorization Payload

```typescript
{
  scheme: 'erc3009',           // Required: payment scheme identifier
  chainId: number,             // Required: EVM chain ID (e.g., 8453 for Base, 84532 for Base Sepolia)
  tokenAddress: string,        // Required: ERC-20 token contract address (lowercase hex)
  payTo: string,               // Required: recipient address (lowercase hex)
  amountAtomic: string,        // Required: amount in atomic units (decimal string, no leading zeros)
  authorization: {
    from: string,              // Required: payer address (lowercase hex, 42 chars)
    to: string,                // Required: recipient address (lowercase hex, 42 chars)
    value: string,             // Required: amount in atomic units (decimal string, must match amountAtomic)
    validAfter: string,        // Required: Unix timestamp (decimal string)
    validBefore: string,       // Required: Unix timestamp (decimal string)
    nonce: string,             // Required: unique nonce (lowercase hex, 66 chars: 0x + 64 hex)
    signature: string          // Required: EIP-712 signature (lowercase hex, 132 chars: 0x + 130 hex)
  }
}
```

### Field Requirements

| Field | Type | Format | Example | Notes |
|-------|------|--------|---------|-------|
| `scheme` | string | constant | `"erc3009"` | Must be exactly this value |
| `chainId` | number | integer | `8453` | **MUST be number, not string** |
| `tokenAddress` | string | hex | `"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"` | Lowercase, ERC-20 contract |
| `payTo` | string | hex | `"0x1234...abcd"` | Lowercase, recipient |
| `amountAtomic` | string | decimal | `"10000"` | No leading zeros (e.g., "10000" not "0010000") |
| `authorization.from` | string | hex | `"0xabcd...1234"` | Lowercase, 42 chars total |
| `authorization.to` | string | hex | `"0x1234...abcd"` | Lowercase, must match `payTo` |
| `authorization.value` | string | decimal | `"10000"` | Must match `amountAtomic` exactly |
| `authorization.validAfter` | string | decimal | `"1740672089"` | Unix seconds |
| `authorization.validBefore` | string | decimal | `"1740672154"` | Unix seconds |
| `authorization.nonce` | string | hex | `"0xf374...3480"` | Lowercase, 66 chars total |
| `authorization.signature` | string | hex | `"0x1234...abcd"` | Lowercase, 132 chars total |

### Critical Requirements

1. **chainId MUST be number** - Common mistake: sending as string
2. **All numeric values MUST be decimal strings** - No leading zeros
3. **All hex values MUST be lowercase** - Addresses, nonces, signatures
4. **value MUST match amountAtomic** - Server validates this
5. **to MUST match payTo** - Server validates this
6. **Signature MUST be 132 characters** - 0x + 130 hex chars (65 bytes)
7. **Nonce MUST be 66 characters** - 0x + 64 hex chars (32 bytes)

## Response Schema

### Success (200 OK)

```typescript
{
  ok: true,
  verified: boolean,        // true if authorization is valid
  txHash?: string,          // optional: on-chain transaction hash if settled
  // ... additional fields may be present
}
```

### Error (4xx/5xx)

```typescript
{
  error: string,            // Error code or message
  message?: string,         // Human-readable error description
  details?: string          // Additional error context
}
```

### Common Error Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| 400 | Bad Request | Check payload schema, field types, values |
| 401 | Unauthorized | Check API credentials (if required) |
| 403 | Forbidden | Check permissions or rate limits |
| 404 | Not Found | Check endpoint path |
| 405 | Method Not Allowed | Ensure using POST |
| 415 | Unsupported Media Type | Check Content-Type header |
| 422 | Unprocessable Entity | Validation error (wrong values, expired auth, etc.) |
| 500 | Internal Server Error | Facilitator issue - retry with backoff |
| 503 | Service Unavailable | Facilitator down - retry with backoff |

## Example Request

```bash
curl -X POST https://x402.org/facilitator/verify \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "User-Agent: agent-dj-radio/1.0 (+x402)" \
  -d '{
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
      "validBefore": "1740672154",
      "nonce": "0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480",
      "signature": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
    }
  }'
```

## Common Issues & Debugging

### Issue: 405 Method Not Allowed / 404 Not Found

**Likely cause**: Wrong path construction

**Examples of wrong paths:**
- ❌ `https://x402.org/verify` (missing `/facilitator`)
- ❌ `https://x402.org/facilitator/facilitator/verify` (duplicated `/facilitator`)

**Correct path:**
- ✅ `https://x402.org/facilitator/verify`

**Fix**: Use `joinUrl(baseUrl, 'verify')` helper which handles trailing slashes

### Issue: 400 Bad Request / 422 Validation Error

**Likely causes:**
1. `chainId` sent as string instead of number
2. Leading zeros in numeric values (e.g., `"0010000"`)
3. Mixed-case hex values (e.g., `"0xABCD..."`)
4. Wrong string lengths (signature not 132 chars, nonce not 66 chars)
5. Mismatched values (`value` ≠ `amountAtomic`, `to` ≠ `payTo`)

**Debug**: Log exact payload with `JSON.stringify(payload, null, 2)` and verify each field

### Issue: 503 Service Unavailable / Timeouts

**Likely causes:**
1. Facilitator service actually down
2. Network issues
3. Rate limiting

**Fix**: Implement retry with exponential backoff, map to user-friendly error

## Implementation Notes

### Payload Normalization

All payloads MUST be normalized before sending:

```typescript
// Normalize hex values (addresses, nonces, signatures)
function normalizeHex(hex: string): string {
  if (!hex.startsWith('0x')) throw new Error('Must start with 0x')
  return hex.toLowerCase()
}

// Normalize numeric values (amounts, timestamps)
function asDecString(value: bigint | number | string): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Math.trunc(value).toString()
  if (typeof value === 'string') {
    // Strip leading zeros: "0010000" → "10000"
    return value.replace(/^0+(\d)/, '$1') || '0'
  }
  throw new Error('Invalid numeric type')
}
```

### Validation Checklist

Before calling facilitator `/verify`:

- [ ] `chainId` is number (not string)
- [ ] All addresses are lowercase hex
- [ ] All numeric values are decimal strings without leading zeros
- [ ] `signature.length === 132`
- [ ] `nonce.length === 66`
- [ ] `authorization.value === amountAtomic`
- [ ] `authorization.to === payTo`
- [ ] `validBefore > now` (not expired)
- [ ] `validAfter <= now` (already valid)

## References

- [x402 GitHub Repository](https://github.com/coinbase/x402)
- [EIP-3009 Specification](https://eips.ethereum.org/EIPS/eip-3009)
- [Coinbase Developer Docs](https://docs.cdp.coinbase.com/x402/)
