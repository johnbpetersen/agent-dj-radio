// api/_shared/payments/facilitator/dialects/payaiv1.ts
// PayAI v1 (Daydreams) verify payload builder
// Reference: https://facilitator.daydreams.systems API spec

/**
 * PayAI v1 verify parameters
 * Maps our internal representation to PayAI's nested structure
 */
export interface PayAiVerifyParams {
  network: string           // 'base' | 'base-sepolia' etc.
  payTo: string             // recipient (lowercase)
  tokenAddress: string      // ERC20 address (lowercase)
  amountAtomic: string      // decimal string, no leading zeros
  authorization: {
    from: string
    to: string
    value: string
    validAfter: string
    validBefore: string
    nonce: string
    signature: string
  }
  // Optional metadata for analytics / future settle
  resource?: string         // protected URL or descriptor
  description?: string      // human-readable description
  mimeType?: string         // e.g. 'application/json'
  maxTimeoutSeconds?: number // e.g. 60
}

/**
 * Build PayAI v1 verify request body
 *
 * PayAI uses a nested structure with separate paymentPayload and paymentRequirements
 * Reference spec:
 * {
 *   paymentPayload: { x402Version: 1, scheme: 'exact', network, payload: { signature, authorization } },
 *   paymentRequirements: { scheme: 'exact', network, maxAmountRequired, payTo, asset, resource, ... }
 * }
 *
 * @param p - PayAI verify parameters
 * @returns PayAI v1 verify request body
 */
export function buildPayAiVerifyBody(p: PayAiVerifyParams) {
  return {
    paymentPayload: {
      x402Version: 1,
      scheme: 'exact' as const,
      network: p.network,
      payload: {
        signature: p.authorization.signature,
        authorization: {
          from: p.authorization.from,
          to: p.authorization.to,
          value: p.authorization.value,
          validAfter: p.authorization.validAfter,
          validBefore: p.authorization.validBefore,
          nonce: p.authorization.nonce
        }
      }
    },
    paymentRequirements: {
      scheme: 'exact' as const,
      network: p.network,
      maxAmountRequired: p.amountAtomic,
      payTo: p.payTo,
      asset: p.tokenAddress,
      resource: p.resource ?? 'https://agent-dj-radio.local/resource',
      description: p.description ?? 'Agent DJ Radio track submission',
      mimeType: p.mimeType ?? 'application/json',
      maxTimeoutSeconds: p.maxTimeoutSeconds ?? 60
      // extra is optional; can carry token metadata if needed
      // extra: { name: 'USDC', version: '2' }
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
