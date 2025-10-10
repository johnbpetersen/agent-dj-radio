// api/_shared/payments/facilitator/variants.ts
// Payload variant builders for ERC-3009 facilitator verification
// Generates different payload shapes to handle various facilitator implementations

import { normalizeAuth, assertAuthShape } from './payload.js'

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
    amountAtomic: params.amountAtomic,
    authorization: normalizedAuth
  }
}

/**
 * Variant B: Canonical+ payload (compatibility mode)
 * - chainId as string
 * - Signature at top level AND inside authorization
 * - Modern field names
 */
export function buildCompat(params: PayloadParams) {
  const normalizedAuth = normalizeAuth(params.authorization)
  assertAuthShape(normalizedAuth)

  return {
    scheme: 'erc3009' as const,
    chainId: String(params.chainId),
    tokenAddress: params.tokenAddress.toLowerCase(),
    payTo: params.payTo.toLowerCase(),
    amountAtomic: params.amountAtomic,
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

/**
 * Variant C: Legacy payload
 * - Legacy field names (chain, asset, token, recipient, amount)
 * - chainId as string
 * - Signature at top level AND inside authorization
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
    amount: params.amountAtomic,
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
