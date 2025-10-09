// src/services/x402-signer.ts
// x402 Payment Payload Signer
// Creates EIP-712 signatures for ERC-3009 transferWithAuthorization

import type { WalletClient, Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'

// USDC contract addresses
export const USDC_CONTRACTS = {
  // Base mainnet
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  // Base Sepolia testnet
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
} as const

export interface PaymentChallenge {
  challengeId: string
  pay_to: Address
  amount_atomic: number
  chain: string
  asset: string
  expires_at: string
}

export interface SignedPayload {
  signature: Hex
  authorization: {
    from: Address
    to: Address
    value: string
    validAfter: number
    validBefore: number
    nonce: Hex
  }
}

export interface X402PaymentPayload {
  x402Version: number
  scheme: 'exact'
  network: 'base' | 'base-sepolia'
  payload: SignedPayload
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
): Promise<X402PaymentPayload> {
  if (!client.account) {
    throw new Error('Wallet not connected')
  }

  const userAddress = client.account.address
  const usdcAddress = getUSDCAddress(chainId)
  const network = getNetworkName(chainId)

  // Parse expiry time with validation
  const expiryTimestamp = Date.parse(challenge.expires_at)
  if (isNaN(expiryTimestamp)) {
    throw new Error(`Invalid expires_at timestamp: "${challenge.expires_at}". Expected ISO 8601 format.`)
  }

  // Convert to BigInt for uint256 (no Number() wrapper)
  const amountAtomicString = String(challenge.amount_atomic)
  const value = BigInt(amountAtomicString)
  const validBefore = BigInt(Math.trunc(expiryTimestamp / 1000))
  const validAfter = BigInt(Math.trunc(Date.now() / 1000) - 60)

  // Ensure chainId is a number and integer
  const chainIdNumber = Number(chainId)
  if (!Number.isInteger(chainIdNumber)) {
    throw new Error(`Invalid chainId: ${chainId}. Must be an integer.`)
  }

  // Generate random nonce
  const nonce = generateNonce()

  // Construct authorization message (using BigInt for uint256 fields)
  const authorization = {
    from: userAddress,
    to: challenge.pay_to,
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

  console.log('[x402-signer] Signing payment:', {
    from: userAddress,
    to: challenge.pay_to,
    value: amountAtomicString,
    chainId: chainIdNumber,
    network,
    usdcAddress
  })

  // Debug: Typed data sanity check before signing
  console.log('[x402-signer] Typed data sanity check:', {
    value: value.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    chainId: chainIdNumber,
    valueType: typeof value,
    validAfterType: typeof validAfter,
    validBeforeType: typeof validBefore,
    chainIdType: typeof chainIdNumber
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

    console.log('[x402-signer] Signature created:', {
      signature: signature.slice(0, 10) + '...',
      nonce
    })

    return {
      x402Version: 1,
      scheme: 'exact',
      network,
      payload: {
        signature,
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value.toString(),
          validAfter: Number(authorization.validAfter),
          validBefore: Number(authorization.validBefore),
          nonce: authorization.nonce
        }
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
