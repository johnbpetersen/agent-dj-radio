// src/lib/env.client.ts
// Client-side environment configuration for chain selection
// Parses VITE_* env vars to configure Base Sepolia (84532) or Base mainnet (8453)

export interface ChainConfig {
  chainId: number
  chainIdHex: string
  rpcUrl: string
  chainLabel: 'Base' | 'Base Sepolia'
  explorerUrl: string
}

/**
 * Get chain configuration from environment variables
 * Supports Base mainnet (8453) and Base Sepolia testnet (84532)
 *
 * @throws Error if VITE_X402_CHAIN_ID is invalid
 * @returns ChainConfig object with typed chain parameters
 */
export function getChainConfig(): ChainConfig {
  const chainIdStr = import.meta.env.VITE_X402_CHAIN_ID || '84532' // Default to Sepolia

  const chainId = parseInt(chainIdStr, 10)

  // Validate chain ID
  if (isNaN(chainId)) {
    console.warn(`Invalid VITE_X402_CHAIN_ID: "${chainIdStr}". Defaulting to Base Sepolia (84532)`)
    return getSepoliaConfig()
  }

  if (chainId !== 8453 && chainId !== 84532) {
    console.warn(
      `Unsupported VITE_X402_CHAIN_ID: ${chainId}. Must be 8453 (Base) or 84532 (Base Sepolia). Defaulting to Base Sepolia.`
    )
    return getSepoliaConfig()
  }

  // Base mainnet (8453)
  if (chainId === 8453) {
    const rpcUrl =
      import.meta.env.VITE_BASE_RPC_URL || 'https://mainnet.base.org'

    return {
      chainId: 8453,
      chainIdHex: '0x2105',
      rpcUrl,
      chainLabel: 'Base',
      explorerUrl: 'https://basescan.org'
    }
  }

  // Base Sepolia testnet (84532)
  return getSepoliaConfig()
}

/**
 * Helper to return Base Sepolia config (default fallback)
 */
function getSepoliaConfig(): ChainConfig {
  const rpcUrl =
    import.meta.env.VITE_BASE_RPC_URL || 'https://sepolia.base.org'

  return {
    chainId: 84532,
    chainIdHex: '0x14a74',
    rpcUrl,
    chainLabel: 'Base Sepolia',
    explorerUrl: 'https://sepolia.basescan.org'
  }
}

/**
 * Format chain ID as hex string with 0x prefix
 */
export function toHex(chainId: number): string {
  return `0x${chainId.toString(16)}`
}
