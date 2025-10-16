// api/_shared/payments/facilitator/dialects/payaiv1.ts
// PayAI v1 (Daydreams) verify payload builder
// Reference: https://facilitator.daydreams.systems API spec

/**
 * PayAI v1 verify parameters
 * Maps our internal representation to PayAI's nested structure
 */
export interface PayAiVerifyParams {
  network: 'base' | string  // 'base' | 'base-sepolia' etc.
  payTo: string             // recipient (lowercase)
  tokenAddress: string      // ERC20 address (lowercase)
  amountAtomic: string | number | bigint // Amount in atomic units
  authorization: {
    from: string
    to: string
    value: string | number | bigint
    validAfter: string | number | bigint
    validBefore: string | number | bigint
    nonce: string
    signature: string
  }
  // Optional metadata for analytics / future settle
  resource?: string         // protected URL or descriptor
  description?: string      // human-readable description
}

/**
 * Build PayAI v1 verify request body
 *
 * PayAI uses a nested structure with dual x402Version placement:
 * - Top-level x402Version for parsers that expect it there
 * - Inside paymentPayload.x402Version for parsers that expect it there
 *
 * Payload structure matches Daydreams "exact" variant (untagged union):
 * - paymentPayload.payload contains { authorization, signature }
 * - No "type" tag - matched by field presence
 *
 * @param p - PayAI verify parameters
 * @returns PayAI v1 verify request body
 */
export function buildPayAiVerifyBody(p: PayAiVerifyParams) {
  // Hard-normalize everything PayAI touches
  const auth = {
    from: p.authorization.from.toLowerCase(),
    to: p.authorization.to.toLowerCase(),
    value: String(p.authorization.value),
    validAfter: String(p.authorization.validAfter),
    validBefore: String(p.authorization.validBefore),
    nonce: p.authorization.nonce.toLowerCase(),
    signature: p.authorization.signature.toLowerCase()
  }

  const network = p.network
  const payTo = p.payTo.toLowerCase()
  const asset = p.tokenAddress.toLowerCase()
  const maxAmountRequired = String(p.amountAtomic)

  // ⚠️ Include x402Version BOTH at top level and inside paymentPayload
  // ⚠️ Include authorization + signature inside paymentPayload.payload
  return {
    x402Version: 1, // Top-level for parsers that expect it here
    paymentPayload: {
      x402Version: 1, // Inside paymentPayload for parsers that expect it here
      scheme: 'exact' as const,
      network,
      payload: {
        // Untagged ExactPaymentPayload variant for ERC-3009 authorizations
        // (Daydreams matches by field presence; do NOT add a "type" tag)
        authorization: {
          from: auth.from,
          to: auth.to,
          value: auth.value,
          validAfter: auth.validAfter,
          validBefore: auth.validBefore,
          nonce: auth.nonce
        },
        signature: auth.signature
      }
    },
    paymentRequirements: {
      scheme: 'exact' as const,
      network,
      maxAmountRequired,
      payTo,
      asset,
      // Use an absolute URL; local dev is fine as a placeholder
      resource: p.resource ?? 'http://localhost:5173/resource',
      description: p.description ?? 'Agent DJ Radio track submission',
      mimeType: 'application/json' as const,
      maxTimeoutSeconds: 60
    }
  }
}

/**
 * Parse PayAI v1 verify response
 *
 * Success: { isValid: true, payer: "0x..." }
 * Failure: { isValid: false, invalidReason: "..." }
 *
 * @param json - Response JSON from PayAI
 * @returns Normalized verification result
 */
export function parsePayAiVerifyResponse(json: any): {
  ok: true
  amountPaidAtomic?: string
  tokenFrom?: string
  providerRaw: any
} | {
  ok: false
  code: string
  message: string
  detail?: string
} {
  // Success case
  if (json?.isValid === true) {
    return {
      ok: true as const,
      amountPaidAtomic: json.amount ?? json.amountAtomic,
      tokenFrom: json.payer, // PayAI returns the payer address
      providerRaw: json
    }
  }

  // Failure case
  return {
    ok: false as const,
    code: 'NO_MATCH',
    message: json?.invalidReason ? String(json.invalidReason) : 'Authorization not verified',
    detail: JSON.stringify(json)
  }
}
