# Full x402 Protocol Implementation Plan - Production Base Mainnet

## Current State Analysis
✅ **What's Working:**
- RPC-only mode successfully verifying Base Sepolia transactions
- Payment confirmation flow (402 → payment → verify → queue)
- Real Supabase integration with payment_challenges and payment_confirmations tables
- Security hardening (rate limiting, input validation, error handling)
- Observability (structured logging, metrics, audit trails)

❌ **What's Missing for Production:**
- Full x402 protocol with ERC-3009 transferWithAuthorization signatures
- Client-side wallet integration to create signed payment payloads
- Base mainnet configuration (USDC mainnet contract, real CDP keys)
- Facilitator verification of cryptographic proofs BEFORE settlement
- Production-grade error handling and compliance

---

## Implementation Strategy: Hybrid Approach

**Phase 1: Keep RPC-only working (maintain backward compatibility)**
**Phase 2: Add full x402 protocol alongside RPC-only**
**Phase 3: Production deployment with both modes available**

This allows you to:
- Test full x402 on testnet while keeping RPC-only working
- Gradually migrate users from RPC-only to full protocol
- Roll back if issues arise

---

## Phase 1: Frontend - Wallet Integration & Payment Payload Creation

### 1.1 Install Dependencies
```bash
npm install viem @coinbase/wallet-sdk wagmi
```

### 1.2 Create Wallet Connection Hook
**File: `src/hooks/useWalletConnect.ts`**
- Detect MetaMask/Coinbase Wallet/WalletConnect
- Connect wallet on user action
- Get connected address and signer

### 1.3 Create Payment Signer Service
**File: `src/services/x402-signer.ts`**
- Generate EIP-712 typed data for transferWithAuthorization
- Sign payment payload with connected wallet
- Create X-PAYMENT header format per x402 spec
- Handle signature errors and rejections

**Key EIP-712 Structure:**
```typescript
{
  domain: {
    name: "USD Coin",
    version: "2",
    chainId: 8453, // Base mainnet
    verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // USDC Base
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" }
    ]
  },
  message: {
    from: userAddress,
    to: challenge.pay_to,
    value: challenge.amount_atomic,
    validAfter: Math.floor(Date.now() / 1000),
    validBefore: expiresAt,
    nonce: crypto.randomBytes(32)
  }
}
```

### 1.4 Update PaymentModal Component
**File: `src/components/PaymentModal.tsx`**
- Add "Sign with Wallet" button
- Replace "Paste TX Hash" input with "Sign Payment" flow
- Show signing in progress state
- Handle wallet connection errors
- Submit signed payload to confirm endpoint

---

## Phase 2: Backend - Full x402 Protocol Verification

### 2.1 Install CDP SDK
```bash
npm install @coinbase/coinbase-sdk
```

### 2.2 Create CDP Facilitator Client
**File: `api/_shared/payments/x402-cdp-facilitator.ts`**
- Initialize CDP client with API keys
- Verify payment payload signature
- Call CDP facilitator /verify endpoint
- Handle facilitator responses (verified=true/false)
- Map errors to user-friendly messages

**Key Functions:**
```typescript
async function verifyCDPPayload(params: {
  x402Version: number
  paymentPayload: {
    signature: string
    authorization: {
      from: string
      to: string
      value: string
      validAfter: number
      validBefore: number
      nonce: string
    }
  }
  paymentRequirements: {
    scheme: "exact"
    network: "base"
    maxAmountRequired: string
    payTo: string
    asset: string
  }
}): Promise<VerifyResult>
```

### 2.3 Update Confirm Endpoint
**File: `api/queue/confirm.ts`**
- Add new mode: `X402_MODE=cdp-facilitator`
- Accept `signedPayload` in request body (instead of txHash)
- Verify signature cryptographically
- Call CDP facilitator for verification
- Keep RPC-only mode as fallback

**Request Schema:**
```typescript
// Option A: Full x402 (new)
{
  challengeId: string
  signedPayload: {
    signature: string
    authorization: { ... }
  }
}

// Option B: RPC-only (existing)
{
  challengeId: string
  txHash: string
}
```

### 2.4 Update Challenge Generation
**File: `api/queue/submit.ts` or challenge creation**
- Include full x402 payment requirements in 402 response
- Add scheme, network, asset contract address
- Generate proper nonce for client to use

---

## Phase 3: Configuration & Environment Setup

### 3.1 Environment Variables
**New Required Variables:**
```bash
# Base Mainnet Configuration
X402_MODE=cdp-facilitator  # or keep 'rpc-only' for backward compat
X402_CHAIN=base  # NOT base-sepolia
X402_ACCEPTED_ASSET=USDC
X402_RECEIVING_ADDRESS=0x5563f81AA5e6ae358D3752147A67198C8a528EA6  # ✅ Already set

# CDP Facilitator (Mainnet)
CDP_API_KEY_ID=your-production-cdp-key-id  # ✅ Already set
CDP_API_KEY_SECRET=your-production-cdp-secret  # ✅ Already set
CDP_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402

# USDC Base Mainnet
X402_TOKEN_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
X402_CHAIN_ID=8453

# Base Mainnet RPC (for fallback)
BASE_MAINNET_RPC_URL=https://mainnet.base.org
```

### 3.2 Update Environment Schema
**File: `src/config/env.server.ts`**
- Add `cdp-facilitator` to X402_MODE enum
- Add validation for CDP keys when mode=cdp-facilitator
- Add Base mainnet chain ID (8453)
- Update startup logs to show mainnet config

---

## Phase 4: Testing & Migration Strategy

### 4.1 Testnet Testing (Base Sepolia)
- Test full x402 flow with CDP testnet keys on Sepolia
- Verify signature creation works in all wallets
- Test error scenarios (wrong amount, expired, wrong chain)
- Load test with multiple concurrent payments

### 4.2 Mainnet Staging
- Deploy to staging environment with mainnet config
- Test with small real USDC amounts ($0.01)
- Verify CDP facilitator integration works
- Monitor latency and error rates

### 4.3 Gradual Migration
**Strategy:**
1. Keep RPC-only mode as default for existing users
2. Add "Try New Payment Method" option in UI
3. Gradually increase % of users on full x402
4. Monitor success rates and user feedback
5. Switch default to full x402 once stable

### 4.4 Rollback Plan
- Keep RPC-only mode available
- Add feature flag: `ENABLE_X402_FULL_PROTOCOL=false`
- Monitor error rates and auto-rollback threshold
- Document known issues and workarounds

---

## Phase 5: Production Deployment Checklist

### 5.1 Security
- [ ] Real CDP API keys stored in secrets manager (not .env)
- [ ] Rate limiting on confirm endpoint (prevent abuse)
- [ ] Input validation on signed payloads
- [ ] Signature verification before calling facilitator
- [ ] CORS configured for production domains only
- [ ] No test keys or wallets in production code

### 5.2 Monitoring
- [ ] Alert on facilitator verification failures
- [ ] Track payment success rate metrics
- [ ] Monitor CDP API latency and errors
- [ ] Log all payment attempts with audit trail
- [ ] Dashboard showing payment funnel (402 → sign → verify → confirm)

### 5.3 Compliance
- [ ] CDP facilitator includes KYC/OFAC checks
- [ ] User terms accept crypto payments
- [ ] Privacy policy covers wallet addresses
- [ ] Refund policy documented

### 5.4 User Experience
- [ ] Clear wallet connection instructions
- [ ] Handle all wallet errors gracefully
- [ ] Show transaction in wallet before signing
- [ ] Estimate gas fees (should be $0 with ERC-3009)
- [ ] Success confirmation with track status

---

## Key Files to Create/Modify

**Create:**
1. `src/hooks/useWalletConnect.ts` - Wallet connection
2. `src/services/x402-signer.ts` - EIP-712 signing
3. `api/_shared/payments/x402-cdp-facilitator.ts` - CDP verification
4. `src/components/WalletConnectButton.tsx` - Connect UI
5. `test-x402-full-protocol.sh` - End-to-end test script

**Modify:**
1. `src/components/PaymentModal.tsx` - Add signing flow
2. `api/queue/confirm.ts` - Support signed payloads
3. `src/config/env.server.ts` - Add cdp-facilitator mode
4. `api/health.ts` - Show CDP status
5. `.env.local` → `.env.production` - Mainnet config

---

## Estimated Timeline

- **Phase 1 (Frontend):** 2-3 days
- **Phase 2 (Backend):** 2-3 days
- **Phase 3 (Config):** 1 day
- **Phase 4 (Testing):** 3-5 days
- **Phase 5 (Deploy):** 1-2 days

**Total: ~10-14 days** to production-ready Base mainnet

---

## Success Metrics

- ✅ Users can sign payments with MetaMask/Coinbase Wallet
- ✅ CDP facilitator verifies signatures in <200ms
- ✅ 99%+ payment success rate (no manual txHash entry errors)
- ✅ Zero gas fees for users (ERC-3009 gasless transfers)
- ✅ Full audit trail with cryptographic proof
- ✅ Ready for Base mainnet real transactions

---

## Implementation Status

### Phase 1: Frontend - Wallet Integration ⏳ IN PROGRESS
- [ ] 1.1 Install dependencies (viem, @coinbase/wallet-sdk, wagmi)
- [ ] 1.2 Create wallet connection hook
- [ ] 1.3 Create payment signer service
- [ ] 1.4 Update PaymentModal component

### Phase 2: Backend - Full x402 Protocol ⏸️ PENDING
### Phase 3: Configuration & Environment ⏸️ PENDING
### Phase 4: Testing & Migration ⏸️ PENDING
### Phase 5: Production Deployment ⏸️ PENDING

---

**Last Updated:** 2025-10-08
**Current Phase:** Phase 1 - Frontend Wallet Integration
**Status:** Starting implementation
