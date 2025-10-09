// src/hooks/useWalletConnect.ts
// Wallet connection hook for x402 payment signing
// Supports MetaMask, Coinbase Wallet (injected + SDK), and WalletConnect
// Handles multi-provider injection, EIP-1193 polyfilling, and Base Sepolia chain switching

import { useState, useEffect, useCallback } from 'react'
import { createWalletClient, custom, type WalletClient, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import CoinbaseWalletSDK from '@coinbase/wallet-sdk'

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

const BASE_SEPOLIA_CHAIN_ID = 84532
const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14a74'

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
    console.debug('[useWalletConnect] Found window.coinbaseWalletExtension')
    providers.push(cbExtension)
  }

  if (providers.length === 0) {
    console.debug('[useWalletConnect] No window.ethereum or window.coinbaseWalletExtension found')
    return undefined
  }

  console.debug('[useWalletConnect] Detected providers:', {
    count: providers.length,
    providers: providers.map(p => ({
      isCoinbaseWallet: p?.isCoinbaseWallet,
      isMetaMask: p?.isMetaMask,
      isBraveWallet: p?.isBraveWallet
    }))
  })

  const byFlag = (pred: (p: any) => boolean) => providers.find(pred)
  const coinbase = byFlag(p => p?.isCoinbaseWallet === true)
  const metamask = byFlag(p => p?.isMetaMask === true && !p?.isBraveWallet)

  // Select based on preference
  if (prefer === 'coinbase') {
    const selected = coinbase ?? metamask ?? providers[0]
    console.debug('[useWalletConnect] Selected Coinbase-preferred provider:', {
      isCoinbaseWallet: selected?.isCoinbaseWallet,
      isMetaMask: selected?.isMetaMask
    })
    return selected
  }

  if (prefer === 'metamask') {
    const selected = metamask ?? coinbase ?? providers[0]
    console.debug('[useWalletConnect] Selected MetaMask-preferred provider:', {
      isCoinbaseWallet: selected?.isCoinbaseWallet,
      isMetaMask: selected?.isMetaMask
    })
    return selected
  }

  // Default: prefer Coinbase, then MetaMask, then first available
  const selected = coinbase ?? metamask ?? providers[0]
  console.debug('[useWalletConnect] Selected default provider:', {
    isCoinbaseWallet: selected?.isCoinbaseWallet,
    isMetaMask: selected?.isMetaMask
  })
  return selected
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

  // Log provider capabilities for debugging
  const capabilities = {
    hasRequest: typeof provider.request === 'function',
    hasSend: typeof provider.send === 'function',
    hasSendAsync: typeof provider.sendAsync === 'function'
  }
  console.debug('[useWalletConnect] Provider capabilities:', capabilities)

  // If request already exists, return as-is
  if (capabilities.hasRequest) {
    console.debug('[useWalletConnect] Polyfill branch: native (request already exists)')
    return provider
  }

  // Create request polyfill function
  let requestImpl: (args: { method: string; params?: any[] }) => Promise<any>

  // Branch 1: sendAsync (callback-based, most common for older providers)
  if (capabilities.hasSendAsync) {
    console.debug('[useWalletConnect] Polyfill branch: sendAsync')
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
    // Detect send signature by trying (method, params) first
    requestImpl = ({ method, params = [] }) => {
      try {
        // Try send(method, params) signature
        const result = provider.send(method, params)
        // If it returns a Promise, use it; otherwise wrap in Promise.resolve
        return result && typeof result.then === 'function' ? result : Promise.resolve(result)
      } catch (firstErr) {
        // Fallback: try send({ method, params }) payload signature
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
    console.debug('[useWalletConnect] Polyfill branch: send (trying both signatures)')
  }
  // Branch 3: No compatible method found
  else {
    console.warn(
      '[useWalletConnect] Provider has no request, send, or sendAsync - not EIP-1193 compatible'
    )
    return provider
  }

  // Return a non-mutating wrapper using Object.create
  // This preserves all original properties and methods while adding `request`
  const wrapper = Object.create(provider, {
    request: {
      value: requestImpl,
      writable: false,
      enumerable: false,
      configurable: false
    }
  })

  console.debug('[useWalletConnect] Created EIP-1193 wrapper (no mutation)')
  return wrapper
}

/**
 * Switch or add Base Sepolia network to wallet
 */
async function ensureBaseSepoliaChain(provider: any): Promise<void> {
  try {
    const currentChainId = await provider.request({ method: 'eth_chainId' })
    console.debug('[useWalletConnect] Current chain:', { currentChainId, target: BASE_SEPOLIA_CHAIN_ID_HEX })

    if (currentChainId?.toLowerCase() !== BASE_SEPOLIA_CHAIN_ID_HEX) {
      console.debug('[useWalletConnect] Switching to Base Sepolia...')
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }]
        })
        console.debug('[useWalletConnect] Chain switched successfully')
      } catch (switchErr: any) {
        // Error code 4902 means chain not added yet
        if (switchErr?.code === 4902) {
          console.debug('[useWalletConnect] Chain not found, adding Base Sepolia...')
          const rpcUrl = import.meta.env.VITE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
                chainName: 'Base Sepolia',
                nativeCurrency: {
                  name: 'ETH',
                  symbol: 'ETH',
                  decimals: 18
                },
                rpcUrls: [rpcUrl],
                blockExplorerUrls: ['https://sepolia.basescan.org']
              }
            ]
          })
          console.debug('[useWalletConnect] Chain added successfully')
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
  console.debug('[useWalletConnect] Attempting injected connection:', { prefer })

  const injected = getInjectedProvider(prefer)
  if (!injected) {
    throw new Error('No wallet extension detected. Please install Coinbase Wallet or MetaMask.')
  }

  const provider = ensureRequestPolyfill(injected)
  if (typeof provider.request !== 'function') {
    throw new Error('Wallet extension is not EIP-1193 compatible. Please update your wallet.')
  }

  // Request account access
  console.debug('[useWalletConnect] Requesting accounts...')
  const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' })
  if (!accounts || accounts.length === 0) {
    throw new Error('Wallet did not return any accounts. Please unlock your wallet.')
  }

  const address = accounts[0] as Address
  console.debug('[useWalletConnect] Account connected:', {
    address: address.slice(0, 6) + '...' + address.slice(-4)
  })

  // Ensure Base Sepolia chain
  await ensureBaseSepoliaChain(provider)

  // Create viem wallet client
  const client = createWalletClient({
    account: address,
    chain: baseSepolia,
    transport: custom(provider)
  })

  console.debug('[useWalletConnect] Injected wallet connected successfully')

  return {
    address,
    client,
    chainId: BASE_SEPOLIA_CHAIN_ID,
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
  console.debug('[useWalletConnect] Attempting Coinbase SDK connection (fallback)...')

  const rpcUrl = import.meta.env.VITE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
  const appName = 'Agent DJ Radio'

  const sdk = new CoinbaseWalletSDK({ appName })
  const sdkProvider: any = sdk.makeWeb3Provider(rpcUrl, BASE_SEPOLIA_CHAIN_ID)

  // IMPORTANT: Wrap SDK provider with ensureRequestPolyfill BEFORE first use
  const provider = ensureRequestPolyfill(sdkProvider)
  if (typeof provider.request !== 'function') {
    throw new Error('Coinbase SDK provider is not EIP-1193 compatible after polyfill.')
  }

  console.debug('[useWalletConnect] Requesting accounts from SDK...')
  const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' })
  if (!accounts || accounts.length === 0) {
    throw new Error('Coinbase Wallet SDK did not return any accounts.')
  }

  const address = accounts[0] as Address
  console.debug('[useWalletConnect] SDK account connected:', {
    address: address.slice(0, 6) + '...' + address.slice(-4)
  })

  // Ensure Base Sepolia chain
  await ensureBaseSepoliaChain(provider)

  // Create viem wallet client
  const client = createWalletClient({
    account: address,
    chain: baseSepolia,
    transport: custom(provider)
  })

  console.debug('[useWalletConnect] Coinbase SDK connected successfully')

  return {
    address,
    client,
    chainId: BASE_SEPOLIA_CHAIN_ID,
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
        console.debug('[useWalletConnect] Injected connection failed:', injectedErr.message)

        // If no injected provider and prefer coinbase, try SDK
        if (prefer === 'coinbase' && injectedErr.message.includes('No wallet extension')) {
          console.debug('[useWalletConnect] Falling back to Coinbase SDK...')
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

      console.debug('[useWalletConnect] Connection complete:', {
        address: result.address.slice(0, 6) + '...' + result.address.slice(-4),
        chainId: result.chainId
      })
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
    console.debug('[useWalletConnect] Disconnecting wallet')

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
        console.debug('[useWalletConnect] Switching chain:', { targetChainId, chainIdHex })

        await state.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }]
        })

        setState(prev => ({
          ...prev,
          chainId: targetChainId
        }))

        console.debug('[useWalletConnect] Chain switched successfully')
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
      console.debug('[useWalletConnect] Auto-reconnecting...', { savedProvider })
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
      console.debug('[useWalletConnect] Accounts changed:', { count: accounts.length })
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
      console.debug('[useWalletConnect] Chain changed:', { chainId, chainIdHex })
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
