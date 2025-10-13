// src/hooks/useWalletConnect.ts
// Wallet connection hook for x402 payment signing
// Supports MetaMask, Coinbase Wallet (injected + SDK), and WalletConnect
// Handles multi-provider injection, EIP-1193 polyfilling, and dynamic Base chain switching

import { useState, useEffect, useCallback } from 'react'
import { createWalletClient, custom, type WalletClient, type Address } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import CoinbaseWalletSDK from '@coinbase/wallet-sdk'
import { getChainConfig, type ChainConfig } from '../lib/env.client'

export type WalletProvider = 'metamask' | 'coinbase' | 'any'

interface WalletState {
  isConnected: boolean
  address: Address | null
  chainId: number | null
  provider: any | null
  client: WalletClient | null
}

interface UseWalletConnect {
  // State
  isConnected: boolean
  address: Address | null
  chainId: number | null
  client: WalletClient | null
  isConnecting: boolean
  error: string | null

  // Actions
  connect: (prefer?: WalletProvider) => Promise<void>
  disconnect: () => void
  switchChain: (targetChainId: number) => Promise<void>
}

// Get dynamic chain config from environment
const CHAIN_CONFIG = getChainConfig()

/**
 * Get injected wallet provider, handling multi-injection scenarios
 * Prioritizes based on preference (coinbase/metamask/any)
 *
 * Detection order:
 * 1. window.ethereum.providers[] (multi-provider scenario)
 * 2. window.ethereum (single provider)
 * 3. window.coinbaseWalletExtension (Coinbase extension fallback)
 */
function getInjectedProvider(prefer: WalletProvider = 'any'): any | undefined {
  if (typeof window === 'undefined') return undefined

  const eth: any = (window as any).ethereum
  const cbExtension: any = (window as any).coinbaseWalletExtension

  // Handle multi-provider injection (e.g., MetaMask + Coinbase both installed)
  const providers: any[] = []

  if (eth) {
    if (Array.isArray(eth.providers)) {
      providers.push(...eth.providers)
    } else {
      providers.push(eth)
    }
  }

  // Check for Coinbase extension global
  if (cbExtension && !providers.some(p => p === cbExtension)) {
    providers.push(cbExtension)
  }

  if (providers.length === 0) {
    return undefined
  }

  const byFlag = (pred: (p: any) => boolean) => providers.find(pred)
  const coinbase = byFlag(p => p?.isCoinbaseWallet === true)
  const metamask = byFlag(p => p?.isMetaMask === true && !p?.isBraveWallet)

  // Select based on preference
  if (prefer === 'coinbase') {
    return coinbase ?? metamask ?? providers[0]
  }

  if (prefer === 'metamask') {
    return metamask ?? coinbase ?? providers[0]
  }

  // Default: prefer Coinbase, then MetaMask, then first available
  return coinbase ?? metamask ?? providers[0]
}

/**
 * Polyfill EIP-1193 request method if provider only has send/sendAsync
 * Ensures compatibility with older wallet implementations
 *
 * IMPORTANT: Returns a wrapper via Object.create() that adds `request` without mutating the original provider.
 * This prevents issues with frozen/immutable provider objects.
 */
function ensureRequestPolyfill(provider: any): any {
  if (!provider) return provider

  const capabilities = {
    hasRequest: typeof provider.request === 'function',
    hasSend: typeof provider.send === 'function',
    hasSendAsync: typeof provider.sendAsync === 'function'
  }

  // If request already exists, return as-is
  if (capabilities.hasRequest) {
    return provider
  }

  // Create request polyfill function
  let requestImpl: (args: { method: string; params?: any[] }) => Promise<any>

  // Branch 1: sendAsync (callback-based, most common for older providers)
  if (capabilities.hasSendAsync) {
    requestImpl = ({ method, params = [] }) => {
      return new Promise((resolve, reject) => {
        provider.sendAsync(
          {
            method,
            params,
            id: Date.now(),
            jsonrpc: '2.0'
          },
          (err: any, res: any) => {
            if (err) return reject(err)
            resolve(res?.result)
          }
        )
      })
    }
  }
  // Branch 2: send (try method/params signature first, then payload signature)
  else if (capabilities.hasSend) {
    requestImpl = ({ method, params = [] }) => {
      try {
        const result = provider.send(method, params)
        return result && typeof result.then === 'function' ? result : Promise.resolve(result)
      } catch (firstErr) {
        try {
          const result = provider.send({ method, params, id: Date.now(), jsonrpc: '2.0' })
          return result && typeof result.then === 'function' ? result : Promise.resolve(result)
        } catch (secondErr) {
          return Promise.reject(
            new Error(`send failed with both signatures: ${firstErr}; ${secondErr}`)
          )
        }
      }
    }
  }
  // Branch 3: No compatible method found
  else {
    console.warn(
      '[useWalletConnect] Provider has no request, send, or sendAsync - not EIP-1193 compatible'
    )
    return provider
  }

  // Return a non-mutating wrapper using Object.create
  const wrapper = Object.create(provider, {
    request: {
      value: requestImpl,
      writable: false,
      enumerable: false,
      configurable: false
    }
  })

  return wrapper
}

/**
 * Switch or add Base network to wallet (mainnet or testnet based on env)
 */
async function ensureBaseChain(provider: any, config: ChainConfig): Promise<void> {
  try {
    const currentChainId = await provider.request({ method: 'eth_chainId' })

    if (currentChainId?.toLowerCase() !== config.chainIdHex.toLowerCase()) {
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: config.chainIdHex }]
        })
      } catch (switchErr: any) {
        // Error code 4902 means chain not added yet
        if (switchErr?.code === 4902) {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: config.chainIdHex,
                chainName: config.chainLabel,
                nativeCurrency: {
                  name: 'Ether',
                  symbol: 'ETH',
                  decimals: 18
                },
                rpcUrls: [config.rpcUrl],
                blockExplorerUrls: [config.explorerUrl]
              }
            ]
          })
        } else {
          throw switchErr
        }
      }
    }
  } catch (err: any) {
    console.warn('[useWalletConnect] Chain selection warning (non-fatal):', err.message)
    // Don't throw - binding can still work even if chain switch fails
  }
}

/**
 * Connect to injected wallet provider (MetaMask, Coinbase extension, etc.)
 */
async function connectInjected(prefer: WalletProvider = 'any'): Promise<{
  address: Address
  client: WalletClient
  chainId: number
  provider: any
}> {
  const injected = getInjectedProvider(prefer)
  if (!injected) {
    throw new Error('No wallet extension detected. Please install Coinbase Wallet or MetaMask.')
  }

  const provider = ensureRequestPolyfill(injected)
  if (typeof provider.request !== 'function') {
    throw new Error('Wallet extension is not EIP-1193 compatible. Please update your wallet.')
  }

  const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' })
  if (!accounts || accounts.length === 0) {
    throw new Error('Wallet did not return any accounts. Please unlock your wallet.')
  }

  const address = accounts[0] as Address

  // Ensure Base chain (mainnet or Sepolia based on env)
  await ensureBaseChain(provider, CHAIN_CONFIG)

  // Create viem wallet client with dynamic chain
  const viemChain = CHAIN_CONFIG.chainId === 8453 ? base : baseSepolia
  const client = createWalletClient({
    account: address,
    chain: viemChain,
    transport: custom(provider)
  })

  return {
    address,
    client,
    chainId: CHAIN_CONFIG.chainId,
    provider
  }
}

/**
 * Connect using Coinbase Wallet SDK (fallback when no extension installed)
 */
async function connectCoinbaseSdk(): Promise<{
  address: Address
  client: WalletClient
  chainId: number
  provider: any
}> {
  const appName = 'Agent DJ Radio'

  const sdk = new CoinbaseWalletSDK({ appName })
  const sdkProvider: any = sdk.makeWeb3Provider(CHAIN_CONFIG.rpcUrl, CHAIN_CONFIG.chainId)

  // IMPORTANT: Wrap SDK provider with ensureRequestPolyfill BEFORE first use
  const provider = ensureRequestPolyfill(sdkProvider)
  if (typeof provider.request !== 'function') {
    throw new Error('Coinbase SDK provider is not EIP-1193 compatible after polyfill.')
  }

  const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' })
  if (!accounts || accounts.length === 0) {
    throw new Error('Coinbase Wallet SDK did not return any accounts.')
  }

  const address = accounts[0] as Address

  // Ensure correct Base chain (mainnet or Sepolia based on env)
  await ensureBaseChain(provider, CHAIN_CONFIG)

  // Create viem wallet client with dynamic chain
  const viemChain = CHAIN_CONFIG.chainId === 8453 ? base : baseSepolia
  const client = createWalletClient({
    account: address,
    chain: viemChain,
    transport: custom(provider)
  })

  return {
    address,
    client,
    chainId: CHAIN_CONFIG.chainId,
    provider
  }
}

export function useWalletConnect(): UseWalletConnect {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    address: null,
    chainId: null,
    provider: null,
    client: null
  })
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Connect wallet with preference for injected or SDK fallback
   */
  const connect = useCallback(async (prefer: WalletProvider = 'coinbase') => {
    setIsConnecting(true)
    setError(null)

    try {
      let result: { address: Address; client: WalletClient; chainId: number; provider: any }

      try {
        // Try injected wallet first (with preference)
        result = await connectInjected(prefer)
      } catch (injectedErr: any) {
        // If no injected provider and prefer coinbase, try SDK
        if (prefer === 'coinbase' && injectedErr.message.includes('No wallet extension')) {
          result = await connectCoinbaseSdk()
        } else {
          // Re-throw original error
          throw injectedErr
        }
      }

      // Update state
      setState({
        isConnected: true,
        address: result.address,
        chainId: result.chainId,
        provider: result.provider,
        client: result.client
      })

      // Save to localStorage for auto-reconnect
      localStorage.setItem('walletProvider', prefer)
      localStorage.setItem('walletAddress', result.address)
    } catch (err: any) {
      console.error('[useWalletConnect] Connection error:', err)

      // User-friendly error messages
      let errorMessage = err.message || 'Failed to connect wallet'

      if (err.message?.includes('User rejected')) {
        errorMessage = 'Connection request rejected. Please approve the connection in your wallet.'
      } else if (err.message?.includes('User denied')) {
        errorMessage = 'Account access denied. Please approve the account access in your wallet.'
      }

      setError(errorMessage)
      setState({
        isConnected: false,
        address: null,
        chainId: null,
        provider: null,
        client: null
      })
    } finally {
      setIsConnecting(false)
    }
  }, [])

  /**
   * Disconnect wallet
   */
  const disconnect = useCallback(() => {
    setState({
      isConnected: false,
      address: null,
      chainId: null,
      provider: null,
      client: null
    })
    setError(null)

    // Clear localStorage
    localStorage.removeItem('walletProvider')
    localStorage.removeItem('walletAddress')
  }, [])

  /**
   * Switch to different chain
   */
  const switchChain = useCallback(
    async (targetChainId: number) => {
      if (!state.provider) {
        setError('No wallet connected')
        return
      }

      try {
        const chainIdHex = `0x${targetChainId.toString(16)}`

        await state.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }]
        })

        setState(prev => ({
          ...prev,
          chainId: targetChainId
        }))
      } catch (err: any) {
        console.error('[useWalletConnect] Chain switch error:', err)

        if (err.code === 4902) {
          setError('This network has not been added to your wallet. Please add it manually.')
        } else {
          setError(err.message || 'Failed to switch network')
        }
      }
    },
    [state.provider]
  )

  /**
   * Auto-reconnect on page load
   */
  useEffect(() => {
    const savedProvider = localStorage.getItem('walletProvider') as WalletProvider | null
    const savedAddress = localStorage.getItem('walletAddress')

    if (savedProvider && savedAddress) {
      connect(savedProvider).catch(err => {
        console.warn('[useWalletConnect] Auto-reconnect failed:', err)
        // Clear stale data
        localStorage.removeItem('walletProvider')
        localStorage.removeItem('walletAddress')
      })
    }
  }, [connect])

  /**
   * Listen for account and chain changes
   */
  useEffect(() => {
    if (!state.provider) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect()
      } else {
        setState(prev => ({
          ...prev,
          address: accounts[0] as Address
        }))
        localStorage.setItem('walletAddress', accounts[0])
      }
    }

    const handleChainChanged = (chainIdHex: string) => {
      const chainId = parseInt(chainIdHex, 16)
      setState(prev => ({
        ...prev,
        chainId
      }))
    }

    state.provider.on?.('accountsChanged', handleAccountsChanged)
    state.provider.on?.('chainChanged', handleChainChanged)

    return () => {
      state.provider.removeListener?.('accountsChanged', handleAccountsChanged)
      state.provider.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [state.provider, disconnect])

  return {
    isConnected: state.isConnected,
    address: state.address,
    chainId: state.chainId,
    client: state.client,
    isConnecting,
    error,
    connect,
    disconnect,
    switchChain
  }
}
