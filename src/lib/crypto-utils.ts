// src/lib/crypto-utils.ts
// Utilities for masking sensitive crypto data in logs

/**
 * Mask a transaction hash for logging
 * Shows first 10 chars + last 6 chars
 * Example: 0x1234567890abcdef... → 0x12345678...abcdef
 */
export function maskTxHash(txHash: string): string {
  if (!txHash) return '(empty)'
  if (txHash.length <= 16) return txHash // Too short to mask meaningfully

  const prefix = txHash.substring(0, 10)
  const suffix = txHash.substring(txHash.length - 6)
  return `${prefix}...${suffix}`
}

/**
 * Mask an Ethereum address for logging
 * Shows first 6 chars + last 4 chars
 * Example: 0x5563f81AA5e6ae358D3752147A67198C8a528EA6 → 0x5563...8EA6
 */
export function maskAddress(address: string): string {
  if (!address) return '(empty)'
  if (address.length <= 10) return address

  const prefix = address.substring(0, 6)
  const suffix = address.substring(address.length - 4)
  return `${prefix}...${suffix}`
}

/**
 * Normalize an Ethereum address for comparison
 * Lowercase + trim whitespace
 */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase()
}

/**
 * Normalize chain/asset names for comparison
 * Lowercase + trim + collapse whitespace
 */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase().replace(/\s+/g, '-')
}
