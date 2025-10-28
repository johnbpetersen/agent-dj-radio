// src/services/x402-signer.ts
// x402 Payment Payload Signer
// Creates EIP-712 signatures for ERC-3009 transferWithAuthorization

import type { WalletClient, Address, Hex } from 'viem'

// USDC contract addresses
export const USDC_CONTRACTS = {
  // Base mainnet
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  // Base Sepolia testnet
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
} as const

export interface PaymentChallenge {
  challengeId: string
  // Prefer camelCase, but accept snake_case for backward compatibility
  payTo?: Address
  pay_to?: Address
  amountAtomic?: string | number
  amount?: string | number
  amount_atomic?: number
  chain?: string
  chainId?: number
  asset?: string
  tokenAddress?: string
  expiresAt?: string
  expires_at?: string
  expiry?: string
  expiresAtSec?: number  // Unix seconds, optional optimization
}

export interface X402Authorization {
  signature: `0x${string}`
  authorization: {
    from: `0x${string}`
    to: `0x${string}`
    value: string
    validAfter: number
    validBefore: number
    nonce: `0x${string}`
  }
}

/**
 * Generate a random nonce for ERC-3009
 */
function generateNonce(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex
}

/**
 * Get USDC contract address for chain
 */
function getUSDCAddress(chainId: number): Address {
  const address = USDC_CONTRACTS[chainId as keyof typeof USDC_CONTRACTS]
  if (!address) {
    throw new Error(`USDC contract not configured for chain ID ${chainId}`)
  }
  return address
}

/**
 * Get network name from chain ID
 */
function getNetworkName(chainId: number): 'base' | 'base-sepolia' {
  switch (chainId) {
    case 8453:
      return 'base'
    case 84532:
      return 'base-sepolia'
    default:
      throw new Error(`Unsupported chain ID: ${chainId}`)
  }
}

/**
 * Sign x402 payment payload using EIP-712
 *
 * This creates a transferWithAuthorization signature per ERC-3009 standard.
 * The signature allows the receiving address (payTo) to pull funds from
 * the user's wallet without requiring gas from the user.
 *
 * @param client - Viem wallet client (connected wallet)
 * @param challenge - Payment challenge from server
 * @param chainId - Current chain ID (8453 = Base mainnet, 84532 = Base Sepolia)
 * @returns Signed payment payload ready for submission
 */
export async function signX402Payment(
  client: WalletClient,
  challenge: PaymentChallenge,
  chainId: number
): Promise<X402Authorization> {
  if (!client.account) {
    throw new Error('Wallet not connected')
  }

  const userAddress = client.account.address
  const usdcAddress = getUSDCAddress(chainId)
  const network = getNetworkName(chainId)

  // Robust field extraction: prefer camelCase, fallback to snake_case
  const iso =
    challenge.expiresAt ??
    (challenge as any).expires_at ??
    (challenge as any).expiry ??
    null

  if (!iso) {
    throw new Error('Invalid expiresAt: missing on challenge')
  }

  const expiresAtMs = Date.parse(iso)
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error(`Invalid expiresAt: "${iso}"`)
  }

  // Extract amount: prefer camelCase, validate format
  const amountAtomic =
    challenge.amountAtomic ??
    challenge.amount ??
    (challenge as any).amount_atomic ??
    ''

  const amountAtomicString = String(amountAtomic)
  if (!/^\d+$/.test(amountAtomicString)) {
    throw new Error(`Invalid amountAtomic string: "${amountAtomicString}"`)
  }

  // Extract payTo address
  const payTo = challenge.payTo ?? (challenge as any).pay_to
  if (!payTo) {
    throw new Error('Invalid payTo: missing on challenge')
  }

  // Convert to BigInt for uint256 (no Number() wrapper)
  // Normalize value: remove leading zeros by converting to BigInt and back to string
  const value = BigInt(amountAtomicString)
  const normalizedValue = value.toString()

  // Use expiresAtSec if available, otherwise parse ISO string
  const validBefore = challenge.expiresAtSec
    ? BigInt(challenge.expiresAtSec)
    : BigInt(Math.trunc(expiresAtMs / 1000))

  const nowSec = Math.trunc(Date.now() / 1000)
  const validAfter = BigInt(nowSec - 60) // small skew

  // Ensure chainId is a number and integer
  const chainIdNumber = Number(chainId)
  if (!Number.isInteger(chainIdNumber)) {
    throw new Error(`Invalid chainId: ${chainId}. Must be an integer.`)
  }

  // Generate random nonce (ensure lowercase)
  const nonce = generateNonce().toLowerCase() as Hex

  // Construct authorization message (using BigInt for uint256 fields)
  const authorization = {
    from: userAddress,
    to: payTo as Address,
    value,
    validAfter,
    validBefore,
    nonce
  }

  // EIP-712 domain for USDC on Base
  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId: chainIdNumber,
    verifyingContract: usdcAddress
  } as const

  // EIP-712 type definition for TransferWithAuthorization
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ]
  } as const

  // Human-readable amount for debugging
  const amountUSD = (Number(normalizedValue) / 1_000_000).toFixed(6)

  console.log('[x402] signing:', {
    value: normalizedValue,
    amountUSD: `$${amountUSD}`,
    to: payTo,
    from: userAddress,
    validAfter: Number(validAfter),
    validBefore: Number(validBefore),
    nonce: nonce.slice(0, 10) + '...',
    chainId: chainIdNumber
  })

  try {
    // Sign with EIP-712
    const signature = await client.signTypedData({
      account: client.account,
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message: authorization
    })

    console.log('[x402] signature created:', signature.slice(0, 10) + '...')

    // Return normalized structure (all lowercase addresses, no leading zeros in value)
    return {
      signature: signature.toLowerCase() as `0x${string}`,
      authorization: {
        from: authorization.from.toLowerCase() as `0x${string}`,
        to: authorization.to.toLowerCase() as `0x${string}`,
        value: normalizedValue, // Use normalized value (no leading zeros)
        validAfter: Number(authorization.validAfter),
        validBefore: Number(authorization.validBefore),
        nonce: authorization.nonce.toLowerCase() as `0x${string}` // Already lowercase, but double-check
      }
    }

  } catch (error: any) {
    console.error('[x402-signer] Signing error:', error)

    // Handle common errors
    if (error.message?.includes('User rejected')) {
      throw new Error('Payment signature rejected. Please approve the transaction in your wallet.')
    }

    if (error.message?.includes('Chain mismatch')) {
      throw new Error(`Please switch to ${network === 'base' ? 'Base' : 'Base Sepolia'} network in your wallet.`)
    }

    throw new Error(`Failed to sign payment: ${error.message || 'Unknown error'}`)
  }
}

/**
 * Validate that wallet is on correct chain for payment
 */
export function validateChain(chainId: number, expectedNetwork: 'base' | 'base-sepolia'): boolean {
  const expected = expectedNetwork === 'base' ? 8453 : 84532
  return chainId === expected
}

/**
 * Get expected chain ID from network name
 */
export function getExpectedChainId(network: 'base' | 'base-sepolia'): number {
  return network === 'base' ? 8453 : 84532
}

/**
 * Format amount for display (convert atomic to decimal)
 */
export function formatUSDCAmount(atomicAmount: number): string {
  return (atomicAmount / 1_000_000).toFixed(2)
}
