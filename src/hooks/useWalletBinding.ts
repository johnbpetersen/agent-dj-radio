// src/hooks/useWalletBinding.ts
// Hook for wallet binding flow in RPC-only payment mode
// Handles message construction, signing, and prove endpoint calls

import { useState, useCallback, useEffect } from 'react'
import type { WalletClient } from 'viem'
import { proveWallet, PaymentError } from '../lib/paymentClient'
import { buildBindingMessageV1 } from '../shared/binding-message'

export interface BindingMessage {
  message: string
  issuedAt: number
  nonce: string
}

export interface BindingState {
  // Binding status
  isBound: boolean
  boundAddress: string | null
  boundAt: string | null

  // UI states
  isProving: boolean
  error: string | null

  // Message preview
  messagePreview: BindingMessage | null
}

export interface UseWalletBinding {
  // State
  state: BindingState

  // Actions
  buildMessage: (challengeId: string) => BindingMessage
  proveOwnership: (client: WalletClient, challengeId: string, message: BindingMessage) => Promise<void>
  reset: () => void
}

/**
 * Build binding message v1 using shared module
 * Format:
 * ```
 * Agent DJ Radio Wallet Binding v1
 * challengeId={uuid}; ts={unix}; ttl={seconds}
 * nonce={32-hex}
 * ```
 */
function buildBindingMessage(challengeId: string): BindingMessage {
  const issuedAt = Math.floor(Date.now() / 1000) // Unix seconds
  const ttl = 300 // 5 minutes (from env or default)

  // Get TTL from env if available (client-side)
  const envTtl = import.meta.env.VITE_BINDING_TTL_SECONDS
  const ttlSeconds = envTtl ? parseInt(envTtl, 10) : ttl

  const message = buildBindingMessageV1({
    challengeId,
    ts: issuedAt,
    ttl: ttlSeconds
  })

  // Extract nonce from message for compatibility with existing interface
  const lines = message.split('\n')
  const nonceLine = lines[2] || ''
  const nonceMatch = nonceLine.match(/nonce=([0-9a-fA-F]{64})/)
  const nonce = nonceMatch ? nonceMatch[1] : ''

  // Log preview for debugging
  console.log('[useWalletBinding] Built message:', {
    preview: message.slice(0, 80) + '...',
    length: message.length,
    lineCount: lines.length,
    nonce: nonce.slice(0, 6) + '...' + nonce.slice(-4)
  })

  return {
    message,
    issuedAt,
    nonce
  }
}

/**
 * Check if binding message is expired (> 5 minutes old)
 */
function isMessageExpired(message: BindingMessage, ttlSeconds: number = 300): boolean {
  const now = Math.floor(Date.now() / 1000)
  const age = now - message.issuedAt
  return age > ttlSeconds
}

/**
 * Hook for managing wallet binding state and operations
 */
export function useWalletBinding(): UseWalletBinding {
  const [state, setState] = useState<BindingState>({
    isBound: false,
    boundAddress: null,
    boundAt: null,
    isProving: false,
    error: null,
    messagePreview: null
  })

  /**
   * Build a binding message for preview and signing
   */
  const buildMessage = useCallback((challengeId: string): BindingMessage => {
    const message = buildBindingMessage(challengeId)

    setState(prev => ({
      ...prev,
      messagePreview: message,
      error: null
    }))

    return message
  }, [])

  /**
   * Prove wallet ownership via signature + server verification
   */
  const proveOwnership = useCallback(async (
    client: WalletClient,
    challengeId: string,
    message: BindingMessage
  ): Promise<void> => {
    setState(prev => ({ ...prev, isProving: true, error: null }))

    try {
      // Check message not expired before signing
      if (isMessageExpired(message)) {
        throw new Error('Message has expired. Please generate a new message.')
      }

      // Get account from client
      if (!client.account) {
        throw new Error('No account connected to wallet client')
      }

      // Sign message using viem's signMessage
      console.log('[useWalletBinding] Requesting signature from wallet...')
      const signature = await client.signMessage({
        account: client.account,
        message: message.message
      })

      console.log('[useWalletBinding] Signature received, verifying with server...')

      // Call prove endpoint
      const response = await proveWallet({
        challengeId,
        message: message.message,
        signature
      })

      console.log('[useWalletBinding] Wallet binding successful:', {
        address: response.address.slice(0, 6) + '...' + response.address.slice(-4)
      })

      // Update state with bound address
      setState(prev => ({
        ...prev,
        isBound: true,
        boundAddress: response.address,
        boundAt: new Date().toISOString(),
        isProving: false,
        error: null,
        messagePreview: null
      }))

    } catch (err: any) {
      console.error('[useWalletBinding] Prove error:', err)

      let errorMessage: string

      if (err instanceof PaymentError) {
        // Server error with structured code
        errorMessage = err.getUserMessage()

        // Add helpful context for specific errors
        if (err.isExpired()) {
          errorMessage = 'Signature expired. Please try again with a fresh message.'
        }
      } else if (err.message?.includes('User rejected')) {
        errorMessage = 'Signature rejected. Please approve the signature request to continue.'
      } else if (err.message?.includes('expired')) {
        errorMessage = err.message
      } else {
        errorMessage = err.message || 'Failed to prove wallet ownership. Please try again.'
      }

      setState(prev => ({
        ...prev,
        isProving: false,
        error: errorMessage
      }))

      // Re-throw so caller can handle if needed
      throw err
    }
  }, [])

  /**
   * Reset binding state (for rebinding)
   */
  const reset = useCallback(() => {
    setState({
      isBound: false,
      boundAddress: null,
      boundAt: null,
      isProving: false,
      error: null,
      messagePreview: null
    })
  }, [])

  // Auto-reset message preview after 5 minutes to prevent expired signatures
  useEffect(() => {
    if (!state.messagePreview) return

    const checkExpiry = () => {
      if (state.messagePreview && isMessageExpired(state.messagePreview)) {
        console.log('[useWalletBinding] Message preview expired, clearing...')
        setState(prev => ({
          ...prev,
          messagePreview: null,
          error: 'Message expired. Please generate a new message.'
        }))
      }
    }

    // Check every 30 seconds
    const interval = setInterval(checkExpiry, 30000)

    return () => clearInterval(interval)
  }, [state.messagePreview])

  return {
    state,
    buildMessage,
    proveOwnership,
    reset
  }
}
