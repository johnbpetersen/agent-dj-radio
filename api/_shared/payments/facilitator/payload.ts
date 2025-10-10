// api/_shared/payments/facilitator/payload.ts
// Payload normalization functions for ERC-3009 facilitator verification
// Pure functions with no network calls

/**
 * Convert any numeric type to decimal string (no leading zeros, no scientific notation)
 * Used for uint256 fields like value, validAfter, validBefore
 *
 * @param x - Value to convert (bigint, number, or string)
 * @returns Decimal string representation
 * @throws Error if input is invalid (non-finite number, non-numeric string)
 */
export function asDecString(x: bigint | number | string): string {
  // BigInt: use native toString()
  if (typeof x === 'bigint') {
    return x.toString()
  }

  // Number: validate finite, truncate decimals, convert to string
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite numeric value: ${x}`)
    }
    return Math.trunc(x).toString()
  }

  // String: strip leading zeros, validate numeric
  if (typeof x === 'string') {
    // Strip leading zeros: "0010000" → "10000", "000" → "0"
    const normalized = x.replace(/^0+(\d)/, '$1') || '0'

    // Validate it's a valid decimal string
    if (!/^\d+$/.test(normalized)) {
      throw new Error(`Invalid decimal string: "${x}"`)
    }

    return normalized
  }

  throw new Error(`Invalid numeric type: ${typeof x}`)
}

/**
 * Normalize hex string to lowercase (addresses, signatures, nonces)
 * Validates that input is a valid hex string with 0x prefix
 *
 * @param hex - Hex string to normalize
 * @returns Lowercase hex string
 * @throws Error if input is not a valid hex string
 */
export function normalizeHex(hex: string): string {
  if (!hex || typeof hex !== 'string') {
    throw new Error(`Invalid hex input: ${hex}`)
  }

  if (!hex.startsWith('0x')) {
    throw new Error(`Hex string must start with 0x: ${hex}`)
  }

  // Validate it's actually hex (0x followed by hex chars)
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid hex string: ${hex}`)
  }

  return hex.toLowerCase()
}

/**
 * Normalize authorization object for wire transmission
 * - All addresses lowercase
 * - All numeric fields as decimal strings
 * - Signature and nonce lowercase
 *
 * @param auth - Raw authorization object with signature
 * @returns Normalized authorization ready for JSON serialization
 */
export function normalizeAuth(auth: {
  from: string
  to: string
  value: string | number | bigint
  validAfter: string | number | bigint
  validBefore: string | number | bigint
  nonce: string
  signature: string
}): {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
  signature: string
} {
  return {
    from: normalizeHex(auth.from),
    to: normalizeHex(auth.to),
    value: asDecString(auth.value),
    validAfter: asDecString(auth.validAfter),
    validBefore: asDecString(auth.validBefore),
    nonce: normalizeHex(auth.nonce),
    signature: normalizeHex(auth.signature)
  }
}

/**
 * Assert authorization object has correct shape and lengths
 * - Signature must be 132 chars (0x + 130 hex chars = 65 bytes)
 * - Nonce must be 66 chars (0x + 64 hex chars = 32 bytes)
 *
 * @param auth - Authorization object to validate
 * @throws Error if shape is invalid
 */
export function assertAuthShape(auth: {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
  signature: string
}): void {
  // Check required fields exist
  const requiredFields = ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce', 'signature']
  for (const field of requiredFields) {
    if (!(field in auth)) {
      throw new Error(`Missing required field: ${field}`)
    }
  }

  // Validate signature length (0x + 130 hex chars = 132 total)
  if (auth.signature.length !== 132) {
    throw new Error(`Invalid signature length: expected 132, got ${auth.signature.length}`)
  }

  // Validate nonce length (0x + 64 hex chars = 66 total)
  if (auth.nonce.length !== 66) {
    throw new Error(`Invalid nonce length: expected 66, got ${auth.nonce.length}`)
  }

  // Validate addresses are non-empty hex
  if (auth.from.length < 3 || auth.to.length < 3) {
    throw new Error('Invalid address length')
  }

  // Validate numeric strings are positive integers
  const numericFields = ['value', 'validAfter', 'validBefore']
  for (const field of numericFields) {
    const value = (auth as any)[field]
    if (!/^\d+$/.test(value)) {
      throw new Error(`Invalid ${field}: must be decimal string`)
    }
  }
}
