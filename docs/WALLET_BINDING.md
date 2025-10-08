# Wallet Binding for RPC-Only Payments

## Overview

Wallet binding is a security feature for RPC-only payment mode that prevents **transaction hash sniping** attacks. Users must cryptographically prove ownership of their wallet before submitting payment, ensuring that only the person who paid can claim credit for the transaction.

## Threat Model

### Attack: Transaction Hash Sniping

**Scenario**: Without wallet binding, an attacker could:
1. Observe the public blockchain for USDC transfers to our receiving address
2. Copy the transaction hash from someone else's payment
3. Submit that transaction hash to our API before the legitimate payer
4. Get credit for a payment they didn't make

**Impact**:
- Legitimate users lose their paid track submissions
- Attackers get free content without paying
- Revenue loss and poor user experience

### Solution: Wallet Binding

**How it works**:
1. User connects their wallet (MetaMask, Coinbase Wallet, etc.)
2. User signs a message proving ownership (no gas fee, instant)
3. Signature binds their wallet address to the payment challenge
4. When verifying payment, server checks `tx.from === bound_address`
5. If mismatch → `WRONG_PAYER` error, payment rejected

**Security properties**:
- **Unforgeable**: Only the wallet owner can produce a valid signature
- **Time-limited**: Messages expire after 5 minutes to prevent replay
- **Verifiable**: Server recovers signer address from signature using ECDSA
- **Non-repudiable**: Audit trail includes message + signature for forensics

## User Flow

### Happy Path

```
1. User submits track request
2. Server generates payment challenge
3. PaymentModal opens with Step 1: "Connect Wallet"
4. User clicks "Connect MetaMask" → wallet connection popup
5. Step 2: "Prove Wallet Ownership" appears
6. User clicks "Sign Message to Prove Wallet" → wallet signature popup
7. User approves signature (no gas fee)
8. ✓ "Wallet Proven: 0x1234...5678" confirmation
9. Step 3: User sends USDC payment from their wallet
10. User copies transaction hash
11. User pastes txHash and clicks "Verify Payment"
12. Server verifies: amount ✓, asset ✓, chain ✓, payer ✓
13. Track confirmed and added to queue
```

### Error Path: WRONG_PAYER

```
1-8. [Same as happy path - wallet bound to 0xAAA...]
9. User accidentally sends payment from DIFFERENT wallet (0xBBB...)
10. User pastes txHash and clicks "Verify Payment"
11. Server checks: tx.from (0xBBB) ≠ bound_address (0xAAA)
12. ❌ WRONG_PAYER error shown:
    "Payment sent from different wallet than proven"
    "Transaction from 0xBBB...1234, expected 0xAAA...5678"
    [Rebind Wallet] button appears
13. User clicks "Rebind Wallet"
14. Binding state resets → back to Step 2
15. User signs with correct wallet (0xBBB)
16. User clicks "Verify Payment" again
17. ✓ Payment confirmed
```

## Message Format

### Exact Message Content

```
Agent DJ Radio — Wallet Proof

Challenge: {challengeId}
Issued At: {unixSeconds}
Nonce: {uuidv4}

By signing, I prove control of this wallet for this payment session.
```

**Example**:
```
Agent DJ Radio — Wallet Proof

Challenge: 550e8400-e29b-41d4-a716-446655440000
Issued At: 1704067200
Nonce: 7c9e6679-7425-40de-944b-e07fc1f90ae7

By signing, I prove control of this wallet for this payment session.
```

### Field Specifications

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `Challenge` | UUID v4 | Links message to specific payment challenge | Must match `challengeId` in database |
| `Issued At` | Unix timestamp (seconds) | When message was generated | Must be ±300s of server time (5 min TTL) |
| `Nonce` | UUID v4 | Prevents replay attacks | Must be unique per signing attempt |

### Why This Format?

1. **Human-readable**: Users can see what they're signing (not just hex)
2. **App-specific**: Includes "Agent DJ Radio" to prevent cross-site signature reuse
3. **Challenge-bound**: Ties signature to specific payment session
4. **Time-limited**: Issued At + TTL prevents old signatures from being reused
5. **Replay-resistant**: Nonce ensures each signature is unique

## API Endpoints

### POST /api/wallet/prove

**Request**:
```json
{
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Agent DJ Radio — Wallet Proof\n\nChallenge: 550e8400-e29b-41d4-a716-446655440000\nIssued At: 1704067200\nNonce: 7c9e6679-7425-40de-944b-e07fc1f90ae7\n\nBy signing, I prove control of this wallet for this payment session.",
  "signature": "0x1234567890abcdef..."
}
```

**Success Response** (200):
```json
{
  "ok": true,
  "address": "0x1234567890123456789012345678901234567890",
  "requestId": "req_abc123"
}
```

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request format (missing fields, invalid signature hex) |
| `NOT_FOUND` | 404 | Payment challenge not found in database |
| `EXPIRED` | 400 | Challenge expired OR message issued >5 minutes ago |
| `INVALID_SIGNATURE` | 400 | Signature verification failed (wrong signer or corrupted) |
| `DB_ERROR` | 500 | Failed to update challenge with bound address |

### POST /api/queue/confirm

Enhanced with binding enforcement when `X402_REQUIRE_BINDING=true`.

**Additional Error Responses**:

| Code | Status | Description | UI Action |
|------|--------|-------------|-----------|
| `WALLET_NOT_BOUND` | 400 | User skipped binding step | Auto-show "Prove Wallet" UI |
| `WRONG_PAYER` | 400 | Transaction sender ≠ bound address | Show addresses + "Rebind Wallet" button |

**WRONG_PAYER Error Detail**:
```json
{
  "error": {
    "code": "WRONG_PAYER",
    "message": "Payment sent from different wallet than proven. Please rebind your wallet or pay from the correct address.",
    "detail": "Transaction from 0xBBB...1234, expected 0xAAA...5678"
  },
  "requestId": "req_xyz789"
}
```

## Configuration

### Environment Variables

```bash
# RPC-only mode with binding (production default)
X402_MODE=rpc-only
X402_REQUIRE_BINDING=true
BINDING_TTL_SECONDS=300  # 5 minutes

# Base Sepolia testnet config
X402_CHAIN_ID=84532
X402_TOKEN_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Receiving address
X402_RECEIVING_ADDRESS=0x5563f81AA5e6ae358D3752147A67198C8a528EA6
```

### Feature Flag Override

To disable binding (legacy mode or emergency rollback):
```bash
X402_REQUIRE_BINDING=false
```

When disabled:
- UI skips wallet connection and signing steps
- Confirm endpoint accepts any transaction without sender validation
- **Security risk**: Vulnerable to tx-hash sniping attacks

## Security Considerations

### Message TTL (5 minutes)

**Why 5 minutes?**
- **Long enough**: Users have time to connect wallet, review message, and sign
- **Short enough**: Limits window for replay attacks if private key compromised
- **Clock skew tolerant**: Server validates ±60s to handle client/server time differences

**What happens after 5 minutes?**
- Frontend auto-clears expired message preview
- Server rejects signature with `EXPIRED` error
- User must generate new message and re-sign

### Signature Security

**What we sign**: Plain text message (EIP-191 personal_sign)
**What we DON'T sign**: Typed data (EIP-712) — overkill for this use case

**Recovery process**:
```typescript
// Server-side (using viem)
const recoveredAddress = await recoverMessageAddress({
  message: bindingMessage,
  signature: userSignature
})

// Verify match
if (normalizeAddress(recoveredAddress) !== normalizeAddress(expectedAddress)) {
  throw new Error('Invalid signature')
}
```

**Why normalize addresses?**
- Ethereum addresses are case-insensitive
- Checksummed addresses (EIP-55) use mixed case
- Normalize to lowercase for comparison: `0xABC` === `0xabc`

### Audit Trail

Every binding is logged with:
- `bound_address`: Recovered signer address
- `bound_at`: Timestamp of binding
- `bound_message`: Full signed message
- `bound_signature`: Signature for verification

**Use cases**:
- Fraud investigation: Verify signature off-chain
- Dispute resolution: Prove user authorized transaction
- Analytics: Track wallet reuse patterns

## Testing

### Manual Test Script

```bash
# 1. Start dev server
npm run dev

# 2. Open http://localhost:5173
# 3. Submit a track request
# 4. When payment modal opens:
#    - Should see "Step 1: Connect Wallet"
#    - Click "Connect MetaMask"
#    - Approve connection

# 5. After connection:
#    - Should see "Step 2: Prove Wallet Ownership"
#    - Should show connected address (0x1234...5678)
#    - Click "Sign Message to Prove Wallet"
#    - Review message in wallet popup
#    - Approve signature (no gas fee)

# 6. After signing:
#    - Should see "✓ Wallet Proven: 0x1234...5678"
#    - Should see "Step 3: Enter Transaction Hash"

# 7. Send USDC payment:
#    - Open MetaMask
#    - Send USDC to displayed address on Base Sepolia
#    - Copy transaction hash

# 8. Verify payment:
#    - Paste txHash
#    - Click "Verify Payment"
#    - Should succeed and show track confirmed

# 9. Test WRONG_PAYER:
#    - Generate new payment challenge
#    - Bind with wallet A (0xAAA...)
#    - Send payment from wallet B (0xBBB...)
#    - Try to verify → should show WRONG_PAYER error
#    - Click "Rebind Wallet"
#    - Sign with wallet B
#    - Verify payment again → should succeed
```

### Automated Tests

See `tests/client/payment-binding.test.tsx` for:
- Happy path (bind → pay → confirm)
- WRONG_PAYER error handling
- WALLET_NOT_BOUND error handling
- Message expiry handling
- Signature rejection handling

## Troubleshooting

### "Signature rejected" Error

**Cause**: User clicked "Cancel" or "Reject" in wallet popup

**Solution**:
- Click "Sign Message to Prove Wallet" again
- This time, click "Approve" in wallet

### "Message expired" Error

**Cause**: More than 5 minutes passed between message generation and signing

**Solution**:
- Refresh the payment modal
- Generate new message and sign immediately

### "WRONG_PAYER" Error After Binding

**Cause**: User switched to different wallet account after binding

**Solution**:
- Click "Rebind Wallet" button
- Sign with the wallet that sent the payment
- OR: Send new transaction from originally bound wallet

### Wallet Not Connecting

**Causes**:
- Wallet extension not installed
- Wallet locked (needs password)
- Wrong network selected in wallet

**Solutions**:
- Install MetaMask or Coinbase Wallet extension
- Unlock wallet by entering password
- Network doesn't need to match (binding works on any network)

## Future Enhancements

### Phase 2: Full x402 Protocol

Current implementation (Phase 1):
- ✅ Wallet binding with EIP-191 signatures
- ✅ RPC verification of on-chain transactions
- ✅ Manual txHash entry

Future implementation (Phase 2):
- 🔜 EIP-712 typed data signatures
- 🔜 ERC-3009 transferWithAuthorization (gasless meta-transactions)
- 🔜 CDP facilitator integration
- 🔜 Automated payment flow (no manual txHash entry)
- 🔜 Base mainnet support

### Why Two Phases?

**Phase 1** (Current): Gets security benefits NOW
- Prevents tx-hash sniping attacks
- Minimal complexity (EIP-191 signing)
- Works with any ERC-20 payment
- 2-3 day implementation

**Phase 2** (Future): Better UX later
- Gasless payments (no wallet ETH needed)
- Automated verification (no copy/paste)
- Enterprise-grade compliance
- 10-14 day implementation

This phased approach delivers immediate security value while maintaining upgrade path to full protocol.

## References

- [EIP-191: Signed Data Standard](https://eips.ethereum.org/EIPS/eip-191)
- [EIP-712: Typed Structured Data Hashing and Signing](https://eips.ethereum.org/EIPS/eip-712)
- [ERC-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009)
- [x402 Protocol Documentation](https://x402.org/docs)
- [Viem Documentation](https://viem.sh/docs/actions/wallet/signMessage)
