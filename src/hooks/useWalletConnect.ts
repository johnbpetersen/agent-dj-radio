// src/hooks/useWalletConnect.ts
// Wallet connection hook for x402 payment signing
// Supports MetaMask, Coinbase Wallet, and WalletConnect

import { useState, useEffect, useCallback } from 'react'
import { createWalletClient, custom, type WalletClient, type Address } from 'viem'
import { base, baseSepolia } from 'viem/chains'

export type WalletProvider = 'metamask' | 'coinbase' | 'walletconnect' | null

interface WalletState {
  isConnected: boolean
  address: Address | null
  chainId: number | null
  provider: WalletProvider
  client: WalletClient | null
}

interface UseWalletConnect {
  // State
  isConnected: boolean
  address: Address | null
  chainId: number | null
  provider: WalletProvider
  client: WalletClient | null
  isConnecting: boolean
  error: string | null

  // Actions
  connect: (provider: WalletProvider) => Promise<void>
  disconnect: () => void
  switchChain: (targetChainId: number) => Promise<void>
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

  // Detect available wallet providers
  const detectProvider = useCallback((providerType: WalletProvider) => {
    if (typeof window === 'undefined') return null

    switch (providerType) {
      case 'metamask':
        return (window as any).ethereum?.isMetaMask ? (window as any).ethereum : null
      case 'coinbase':
        return (window as any).coinbaseSolana || (window as any).coinbaseWalletExtension
      case 'walletconnect':
        // WalletConnect requires additional setup - for now, fallback to window.ethereum
        return (window as any).ethereum
      default:
        return null
    }
  }, [])

  // Connect wallet
  const connect = useCallback(async (providerType: WalletProvider) => {
    if (!providerType) {
      setError('Please select a wallet provider')
      return
    }

    setIsConnecting(true)
    setError(null)

    try {
      const ethereum = detectProvider(providerType)

      if (!ethereum) {
        throw new Error(`${providerType} not detected. Please install the wallet extension.`)
      }

      // Request account access
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' })

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found. Please unlock your wallet.')
      }

      const address = accounts[0] as Address

      // Get chain ID
      const chainIdHex = await ethereum.request({ method: 'eth_chainId' })
      const chainId = parseInt(chainIdHex, 16)

      // Determine which chain to use
      const chain = chainId === 8453 ? base : baseSepolia

      // Create viem wallet client
      const client = createWalletClient({
        account: address,
        chain,
        transport: custom(ethereum)
      })

      setState({
        isConnected: true,
        address,
        chainId,
        provider: providerType,
        client
      })

      // Save to localStorage for persistence
      localStorage.setItem('walletProvider', providerType)
      localStorage.setItem('walletAddress', address)

    } catch (err: any) {
      console.error('[useWalletConnect] Connection error:', err)
      setError(err.message || 'Failed to connect wallet')

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
  }, [detectProvider])

  // Disconnect wallet
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

  // Switch chain
  const switchChain = useCallback(async (targetChainId: number) => {
    if (!state.client) {
      setError('No wallet connected')
      return
    }

    try {
      const ethereum = (window as any).ethereum
      if (!ethereum) throw new Error('Ethereum provider not found')

      const chainIdHex = `0x${targetChainId.toString(16)}`

      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }]
      })

      // Update state after successful switch
      setState(prev => ({
        ...prev,
        chainId: targetChainId
      }))

    } catch (err: any) {
      console.error('[useWalletConnect] Chain switch error:', err)

      // Error code 4902 means the chain hasn't been added yet
      if (err.code === 4902) {
        setError('Please add this network to your wallet first')
      } else {
        setError(err.message || 'Failed to switch network')
      }
    }
  }, [state.client])

  // Auto-reconnect on page load
  useEffect(() => {
    const savedProvider = localStorage.getItem('walletProvider') as WalletProvider
    const savedAddress = localStorage.getItem('walletAddress')

    if (savedProvider && savedAddress) {
      // Attempt to reconnect
      connect(savedProvider).catch(err => {
        console.warn('[useWalletConnect] Auto-reconnect failed:', err)
        // Clear stale data
        localStorage.removeItem('walletProvider')
        localStorage.removeItem('walletAddress')
      })
    }
  }, [connect])

  // Listen for account changes
  useEffect(() => {
    if (typeof window === 'undefined') return

    const ethereum = (window as any).ethereum
    if (!ethereum) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        // User disconnected
        disconnect()
      } else {
        // Account changed - update address
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

    ethereum.on('accountsChanged', handleAccountsChanged)
    ethereum.on('chainChanged', handleChainChanged)

    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged)
      ethereum.removeListener('chainChanged', handleChainChanged)
    }
  }, [disconnect])

  return {
    isConnected: state.isConnected,
    address: state.address,
    chainId: state.chainId,
    provider: state.provider,
    client: state.client,
    isConnecting,
    error,
    connect,
    disconnect,
    switchChain
  }
}
