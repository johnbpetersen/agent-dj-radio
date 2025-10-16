// api/_shared/payments/facilitator/variants.ts
// Payload variant builders for ERC-3009 facilitator verification
// Generates different payload shapes to handle various facilitator implementations

import { normalizeAuth, assertAuthShape, asDecString } from './payload.js'

/**
 * Common parameters for all payload variants
 */
export interface PayloadParams {
  chain: string // e.g., "base", "base-sepolia"
  asset: string // e.g., "usdc"
  chainId: number // e.g., 8453, 84532
  tokenAddress: string // USDC contract address
  payTo: string // Recipient address (facilitator receiving address)
  amountAtomic: string // Amount in atomic units (e.g., "10000" for 0.01 USDC)
  authorization: {
    from: string
    to: string
    value: string | number | bigint
    validAfter: string | number | bigint
    validBefore: string | number | bigint
    nonce: string
    signature: string
  }
}

/**
 * Variant A: Canonical payload
 * - chainId as number
 * - Nested authorization with signature inside
 * - Modern field names (tokenAddress, payTo, amountAtomic)
 */
export function buildCanonical(params: PayloadParams) {
  const normalizedAuth = normalizeAuth(params.authorization)
  assertAuthShape(normalizedAuth)

  return {
    scheme: 'erc3009' as const,
    chainId: params.chainId,
    tokenAddress: params.tokenAddress.toLowerCase(),
    payTo: params.payTo.toLowerCase(),
    amountAtomic: asDecString(params.amountAtomic), // Strip leading zeros
    authorization: normalizedAuth
  }
}

/**
 * Variant B: Canonical+ payload (compatibility mode)
 * - chainId as number (FIXED: was string, now matches spec)
 * - Signature at top level AND inside authorization (for facilitators that expect both)
 * - Modern field names
 */
export function buildCompat(params: PayloadParams) {
  const normalizedAuth = normalizeAuth(params.authorization)
  assertAuthShape(normalizedAuth)

  return {
    scheme: 'erc3009' as const,
    chainId: params.chainId, // ✅ FIXED: Now number (was String(params.chainId))
    tokenAddress: params.tokenAddress.toLowerCase(),
    payTo: params.payTo.toLowerCase(),
    amountAtomic: asDecString(params.amountAtomic), // Strip leading zeros
    signature: normalizedAuth.signature, // Duplicate signature at top level for compatibility
    authorization: normalizedAuth // ✅ Includes signature inside authorization
  }
}

/**
 * Variant C: Legacy payload (DEPRECATED - DO NOT USE)
 *
 * ⚠️  WARNING: This variant uses wrong field names that do NOT match the x402 spec:
 * - Uses `token` instead of `tokenAddress`
 * - Uses `recipient` instead of `payTo`
 * - Uses `amount` instead of `amountAtomic`
 * - Includes extra fields `chain` and `asset` not in spec
 *
 * This variant will ALWAYS FAIL with standard facilitators.
 * Kept only for reference. Use buildCanonical() instead.
 */
export function buildLegacy(params: PayloadParams) {
  const normalizedAuth = normalizeAuth(params.authorization)
  assertAuthShape(normalizedAuth)

  return {
    scheme: 'erc3009' as const,
    chain: params.chain,
    asset: params.asset,
    token: params.tokenAddress.toLowerCase(),
    recipient: params.payTo.toLowerCase(),
    amount: asDecString(params.amountAtomic), // Strip leading zeros
    chainId: String(params.chainId),
    signature: normalizedAuth.signature,
    authorization: {
      from: normalizedAuth.from,
      to: normalizedAuth.to,
      value: normalizedAuth.value,
      validAfter: normalizedAuth.validAfter,
      validBefore: normalizedAuth.validBefore,
      nonce: normalizedAuth.nonce
    }
  }
}
