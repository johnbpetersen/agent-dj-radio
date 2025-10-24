// src/components/PaymentModal.tsx
// Payment modal for x402 challenge fulfillment with wallet binding

import { useState, useEffect } from 'react'
import {
  formatUSDCAmount,
  getExpiryCountdown,
  formatCountdown,
  validateTxHash,
  getChainDisplayName,
  getBlockExplorerUrl,
  type ParsedXPayment
} from '../lib/x402-utils'
import { useWalletConnect } from '../hooks/useWalletConnect'
import { useWalletBinding } from '../hooks/useWalletBinding'
import { confirmPayment, PaymentError } from '../lib/paymentClient'
import { signX402Payment } from '../services/x402-signer'

interface PaymentModalProps {
  challenge: ParsedXPayment
  onSuccess: (trackId: string) => void
  onRefresh: () => void
  onClose: () => void
}

interface HealthResponse {
  features?: {
    x402?: {
      enabled: boolean
      mockEnabled: boolean
      mode?: 'facilitator' | 'rpc-only' | 'cdp' | 'mock' | 'none'
      chainId?: number
      tokenAddress?: string
      receivingAddress?: string
      chain?: string
      asset?: string
      binding?: {
        required: boolean
        ttlSeconds: number
      }
      facilitator?: {
        baseUrl: string
        reachable: boolean
        error: string | null
      }
    }
  }
}

/**
 * Convert unknown error types to readable string
 */
/*
async function toErrorString(x: unknown): Promise<string> {
  if (x instanceof Response) {
    try {
      const data = await x.json()
      return toErrorStringSync(data)
    } catch {
      try {
        const text = await x.text()
        return text || `HTTP ${x.status}`
      } catch {
        return `HTTP ${x.status}`
      }
    }
  }

  return toErrorStringSync(x)
}
*/

function toErrorStringSync(x: unknown): string {
  if (x && typeof x === 'object' && 'error' in x) {
    const errObj = (x as any).error
    const code = errObj?.code || 'UNKNOWN'
    const message = errObj?.message || 'An error occurred'
    const hint = errObj?.hint
    const detail = errObj?.detail

    if (Array.isArray(errObj?.fields) && errObj.fields.length > 0) {
      const fieldMessages = errObj.fields
        .map((f: any) => `${f.path}: ${f.message}`)
        .join(', ')
      return hint
        ? `${code}: ${message} (${fieldMessages}) - ${hint}`
        : `${code}: ${message} (${fieldMessages})`
    }

    if (detail) {
      return `${code}: ${message} - ${detail}`
    }

    return hint ? `${code}: ${message} - ${hint}` : `${code}: ${message}`
  }

  if (x instanceof Error) {
    return x.message
  }

  if (typeof x === 'string') {
    return x
  }

  if (x && typeof x === 'object' && 'message' in x && typeof (x as any).message === 'string') {
    return (x as any).message
  }

  if (x && typeof x === 'object') {
    try {
      const str = JSON.stringify(x)
      return str.length <= 200 ? str : str.substring(0, 197) + '...'
    } catch {
      return 'An unexpected error occurred'
    }
  }

  return String(x) || 'An unexpected error occurred'
}

export function PaymentModal({ challenge, onSuccess, onRefresh, onClose }: PaymentModalProps) {
  if (!challenge) {
    return (
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal-content">
          <h2>Payment Error</h2>
          <p className="error">No payment challenge provided. Please try submitting again.</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  // Wallet connection
  const wallet = useWalletConnect()
  const binding = useWalletBinding()

  // Form state
  const [txHash, setTxHash] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [copied, setCopied] = useState(false)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)

  // Feature flags
  const [isLiveMode, setIsLiveMode] = useState(false)
  const [mocksEnabled, setMocksEnabled] = useState(true)
  const [bindingRequired, setBindingRequired] = useState(false)
  const [paymentMode, setPaymentMode] = useState<'facilitator' | 'rpc-only' | 'mock' | 'none'>('none')
  const [chainId, setChainId] = useState<number | undefined>()
  const [facilitatorReachable, setFacilitatorReachable] = useState(true)
  const [useRpcFallback, setUseRpcFallback] = useState(false)

  // WRONG_PAYER error state
  const [wrongPayerDetail, setWrongPayerDetail] = useState<{
    payerSource?: 'tokenFrom' | 'txSender' | 'txFrom'
    payer?: string
    tokenFrom?: string
    txSender?: string
    boundAddress?: string
    txFrom?: string
  } | null>(null)

  // TX_ALREADY_USED error state
  const [txReuseError, setTxReuseError] = useState<{
    originalTrackId?: string
    originalConfirmedAt?: string
    isWrongPayer: boolean
    payerAddress?: string | null
    boundAddress?: string | null
  } | null>(null)

  // Fetch feature flags on mount
  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then((data: HealthResponse) => {
        const x402Enabled = data.features?.x402?.enabled ?? false
        const mockEnabled = data.features?.x402?.mockEnabled ?? true
        const bindReq = data.features?.x402?.binding?.required ?? false
        const mode = data.features?.x402?.mode ?? 'none'
        const chain = data.features?.x402?.chainId
        const facReachable = data.features?.x402?.facilitator?.reachable ?? true

        setIsLiveMode(x402Enabled)
        setMocksEnabled(mockEnabled)
        setBindingRequired(bindReq)
        // @ts-expect-error TODO(types): PaymentMode type needs to include 'cdp'
        setPaymentMode(mode)
        setChainId(chain)
        setFacilitatorReachable(facReachable)

        console.log('[PaymentModal] Health loaded:', {
          mode,
          chainId: chain,
          bindReq,
          facilitatorReachable: facReachable,
          facilitatorError: data.features?.x402?.facilitator?.error
        })

        // Debug log challenge after health is loaded
        console.debug('[PaymentModal] Challenge from server', {
          challengeId: challenge.challengeId,
          amount: (challenge as any).amount,
          amountAtomic: (challenge as any).amountAtomic,
          expiresAt: challenge.expiresAt,
          chain: challenge.chain,
          chainId: (challenge as any).chainId
        })
      })
      .catch(err => {
        console.warn('Failed to fetch health flags:', err)
        setIsLiveMode(true)
        setMocksEnabled(false)
        setBindingRequired(false)
        setPaymentMode('none')
        setFacilitatorReachable(false)
      })
  }, [challenge])

  // Initialize countdown
  useEffect(() => {
    setCountdown(getExpiryCountdown(challenge.expiresAt))

    const interval = setInterval(() => {
      const remaining = getExpiryCountdown(challenge.expiresAt)
      setCountdown(remaining)

      if (remaining <= 0) {
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [challenge.expiresAt])

  // Rate limit countdown
  useEffect(() => {
    if (retryAfter === null) return

    const interval = setInterval(() => {
      setRetryAfter(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval)
          setIsSubmitting(false)
          setError(null)
          return null
        }
        setError(`RATE_LIMITED: Please wait ${prev - 1}s`)
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [retryAfter])

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(challenge.payTo)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy address:', err)
    }
  }

  const handleProveWallet = async () => {
    if (!wallet.client) {
      setError('No wallet connected')
      return
    }

    setError(null)

    try {
      // Build message
      const message = binding.buildMessage(challenge.challengeId)

      // Prove ownership (will prompt wallet signature)
      await binding.proveOwnership(wallet.client, challenge.challengeId, message)

      // Success handled by binding hook state update
    } catch (err) {
      // Error already set by binding hook
      console.error('[PaymentModal] Prove wallet error:', err)
    }
  }

  const handleSignAndPay = async () => {
    if (!wallet.client || !wallet.address) {
      setError('Please connect your wallet first')
      return
    }

    if (countdown <= 0) {
      setError('Payment challenge has expired. Please refresh to get a new challenge.')
      return
    }

    if (!chainId) {
      setError('Chain configuration not loaded. Please refresh the page.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setWrongPayerDetail(null)
    setTxReuseError(null)

    try {
      console.log('[PaymentModal] Signing ERC-3009 authorization...', {
        challengeId: challenge.challengeId,
        chainId,
        wallet: wallet.address
      })

      // Sign ERC-3009 transferWithAuthorization
      // @ts-expect-error TODO(types): ParsedXPayment needs to extend PaymentChallenge
      const signed = await signX402Payment(wallet.client, challenge, chainId)

      // Debug payload before sending
      console.debug('[PaymentModal] confirm payload preview', {
        hasSignature: typeof signed.signature === 'string',
        sigHead: signed.signature?.slice(0, 10),
        value: signed.authorization.value,
        validAfter: signed.authorization.validAfter,
        validBefore: signed.authorization.validBefore,
        nonceLen: signed.authorization.nonce.length
      })

      console.log('[PaymentModal] Authorization signed, submitting to confirm...')

      // Submit authorization to confirm endpoint (exact shape backend expects)
      const payload = {
        challengeId: challenge.challengeId,
        authorization: {
          signature: signed.signature,
          authorization: signed.authorization
        }
      }

      const response = await confirmPayment(payload)

      // Success!
      if (response.ok && response.trackId) {
        onSuccess(response.trackId)
      } else {
        setError('Payment verified but track ID not returned')
      }
    } catch (err) {
      console.error('Sign & Pay error:', err)

      if (err instanceof PaymentError) {
        // Handle special error codes
        // @ts-expect-error TODO(types): PaymentError data type needs 'fallback' field
        if (err.code === 'PROVIDER_UNAVAILABLE' && err.data?.fallback === 'rpc') {
          // Facilitator is down, switch to RPC paste-tx flow
          console.log('[PaymentModal] Facilitator unavailable, switching to RPC fallback')
          setUseRpcFallback(true)
          setError('Payment service temporarily unavailable. Please use the transaction hash method below.')
        } else if (err.code === 'AUTH_REUSED') {
          const refs = err.getOriginalRefs?.()
          setError(`Authorization already used for payment ${refs?.trackId ? `#${refs.trackId.slice(0, 8)}...` : ''}`)
        } else if (err.status === 429) {
          const retrySeconds = 30
          setRetryAfter(retrySeconds)
          setError(`RATE_LIMITED: Please wait ${retrySeconds}s`)
        } else {
          setError(err.getUserMessage())
        }
      } else {
        const errorMsg = toErrorStringSync(err)
        setError(`Sign & Pay failed: ${errorMsg}`)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVerifyPayment = async () => {
    // Client-side validation
    if (!validateTxHash(txHash)) {
      setError('Invalid transaction hash format. Must be 0x followed by 64 hexadecimal characters.')
      return
    }

    if (countdown <= 0) {
      setError('Payment challenge has expired. Please refresh to get a new challenge.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setWrongPayerDetail(null)
    setTxReuseError(null)

    const payload = {
      challengeId: challenge.challengeId,
      txHash: txHash.trim()
    }
    console.debug('[confirm] payload', payload)

    try {
      const response = await confirmPayment(payload)

      // Success!
      if (response.ok && response.trackId) {
        onSuccess(response.trackId)
      } else {
        setError('Payment verified but track ID not returned')
      }
    } catch (err) {
      console.error('Payment verification error:', err)

      if (err instanceof PaymentError) {
        // Handle special error codes
        if (err.isBindingRequired()) {
          setError('Wallet binding required. Please prove your wallet ownership first.')
        } else if (err.isTxReused()) {
          // TX_ALREADY_USED - transaction hash already used for different payment
          const refs = err.getOriginalRefs()
          const reasonCodes = err.getReasonCodes()

          setTxReuseError({
            originalTrackId: refs?.trackId,
            originalConfirmedAt: refs?.confirmedAt,
            isWrongPayer: reasonCodes.includes('WRONG_PAYER'),
            payerAddress: err.data?.payerAddress,
            boundAddress: err.data?.boundAddress
          })
          setError(err.getUserMessage())
        } else if (err.isWrongPayer()) {
          // Extract payer info from error
          const payerInfo = err.getDetectedPayer()
          setWrongPayerDetail(payerInfo)
          setError(err.getUserMessage())
        } else if (err.status === 429) {
          // Rate limited
          const retrySeconds = 30
          setRetryAfter(retrySeconds)
          setError(`RATE_LIMITED: Please wait ${retrySeconds}s`)
        } else {
          setError(err.getUserMessage())
        }
      } else {
        const errorMsg = toErrorStringSync(err)
        setError(`Network error: ${errorMsg}`)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRebind = () => {
    // Reset binding state and errors
    binding.reset()
    setError(null)
    setWrongPayerDetail(null)
  }

  const handleRefresh = () => {
    onRefresh()
    onClose()
  }

  const isExpired = countdown <= 0
  const formattedAmount = formatUSDCAmount(challenge.amount)
  const chainName = getChainDisplayName(challenge.chain)
  const explorerUrl = txHash && validateTxHash(txHash) ? getBlockExplorerUrl(challenge.chain, txHash) : null

  // Determine UI state based on payment mode and facilitator health
  const isFacilitatorMode = paymentMode === 'facilitator' && !useRpcFallback
  const showSignAndPay = isFacilitatorMode && facilitatorReachable

  // In facilitator mode: wallet connection is required, but binding is optional (ERC-3009 binds payer)
  // In RPC mode: binding is required
  // If useRpcFallback is true, force RPC mode even in facilitator mode
  const needsWallet = (isFacilitatorMode && !useRpcFallback) ? !wallet.isConnected : (bindingRequired && !wallet.isConnected)
  const needsBinding = (!isFacilitatorMode || useRpcFallback) && bindingRequired && wallet.isConnected && !binding.state.isBound
  const canConfirm = (isFacilitatorMode && !useRpcFallback) ? wallet.isConnected : (!bindingRequired || binding.state.isBound)

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content payment-modal">
        <div className="modal-header">
          <h2>Payment Required</h2>
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="payment-details">
          <div className="detail-row">
            <span className="label">Amount:</span>
            <span className="value amount">{formattedAmount}</span>
          </div>

          <div className="detail-row">
            <span className="label">Network:</span>
            <span className="value">{chainName}</span>
          </div>

          <div className="detail-row">
            <span className="label">Pay to:</span>
            <div className="address-container">
              <code className="address">{challenge.payTo}</code>
              <button
                className="copy-button"
                onClick={handleCopyAddress}
                title="Copy address"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="detail-row">
            <span className="label">Expires in:</span>
            <span className={`value countdown ${isExpired ? 'expired' : ''}`}>
              {formatCountdown(countdown)}
            </span>
          </div>
        </div>

        {isExpired ? (
          <div className="expired-notice">
            <p>⚠️ This payment challenge has expired.</p>
            <button className="refresh-button" onClick={handleRefresh}>
              Refresh Challenge
            </button>
          </div>
        ) : (
          <>
            {/* Wallet Connection Section */}
            {needsWallet && (
              <div className="binding-section">
                <h3>{showSignAndPay ? 'Step 1: Connect Wallet' : 'Step 1: Connect Wallet'}</h3>
                <p className="binding-description">
                  {showSignAndPay
                    ? 'Connect your wallet to sign the payment authorization.'
                    : 'To prevent payment fraud, you must prove wallet ownership before paying.'}
                </p>
                <div className="wallet-buttons">
                  <button
                    className="wallet-button metamask"
                    onClick={() => wallet.connect('metamask')}
                    disabled={wallet.isConnecting}
                  >
                    {wallet.isConnecting ? 'Connecting...' : 'Connect MetaMask'}
                  </button>
                  <button
                    className="wallet-button coinbase"
                    onClick={() => wallet.connect('coinbase')}
                    disabled={wallet.isConnecting}
                  >
                    {wallet.isConnecting ? 'Connecting...' : 'Connect Coinbase Wallet'}
                  </button>
                </div>
                {wallet.error && <div className="error-message">{wallet.error}</div>}
              </div>
            )}

            {/* Wallet Binding Section */}
            {needsBinding && (
              <div className="binding-section">
                <h3>Step 2: Prove Wallet Ownership</h3>
                <div className="bound-info">
                  <span className="label">Connected:</span>
                  <code className="bound-address">
                    {wallet.address?.slice(0, 6)}...{wallet.address?.slice(-4)}
                  </code>
                  <button className="disconnect-button" onClick={wallet.disconnect}>
                    Disconnect
                  </button>
                </div>
                <p className="binding-description">
                  Sign a message to prove you control this wallet. This prevents others from using your transaction hash.
                </p>

                {binding.state.messagePreview && (
                  <details className="message-preview">
                    <summary>Message Preview</summary>
                    <pre>{binding.state.messagePreview.message}</pre>
                  </details>
                )}

                <button
                  className="prove-button"
                  onClick={handleProveWallet}
                  disabled={binding.state.isProving}
                >
                  {binding.state.isProving ? 'Waiting for signature...' : 'Sign Message to Prove Wallet'}
                </button>

                {binding.state.error && <div className="error-message">{binding.state.error}</div>}
              </div>
            )}

            {/* Payment Form Section */}
            {canConfirm && (
              <div className="payment-form">
                {/* Facilitator mode with reachable facilitator: Show Sign & Pay */}
                {/* If facilitator is down or useRpcFallback is true, show RPC paste-tx flow */}
                {showSignAndPay ? (
                  <>
                    <div className="wallet-connected">
                      <div className="connected-info">
                        <span className="label">Connected Wallet:</span>
                        <code className="address-display">
                          {wallet.address?.slice(0, 6)}...{wallet.address?.slice(-4)}
                        </code>
                        <button className="disconnect-button" onClick={wallet.disconnect}>
                          Disconnect
                        </button>
                      </div>
                      <p className="facilitator-notice">
                        Click below to sign a payment authorization. Your wallet will prompt you to sign (no gas required).
                      </p>
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button
                      className="sign-pay-button"
                      onClick={handleSignAndPay}
                      disabled={isSubmitting || retryAfter !== null}
                    >
                      {retryAfter !== null
                        ? `Please wait ${retryAfter}s`
                        : isSubmitting
                        ? 'Signing...'
                        : 'Sign & Pay (x402)'}
                    </button>
                  </>
                ) : (
                  /* RPC mode: Show tx-hash input */
                  /* Also shown if facilitator is down (fallback) */
                  <>
                    {/* Facilitator unavailable notice */}
                    {useRpcFallback && (
                      <div className="facilitator-unavailable-notice">
                        <p>⚠️ Payment service temporarily unavailable</p>
                        <p className="fallback-description">
                          The gasless payment service is currently down. Please use the manual transaction method below.
                        </p>
                      </div>
                    )}

                    {binding.state.isBound && (
                      <div className="bound-status">
                        ✓ Wallet Proven: <code>{binding.state.boundAddress?.slice(0, 6)}...{binding.state.boundAddress?.slice(-4)}</code>
                        <button className="rebind-link" onClick={handleRebind}>Change</button>
                      </div>
                    )}

                    <label htmlFor="txHash">
                      {binding.state.isBound ? 'Step 3: Enter' : ''} Transaction Hash:
                    </label>
                    <input
                      id="txHash"
                      type="text"
                      value={txHash}
                      onChange={(e) => setTxHash(e.target.value)}
                      placeholder="0x..."
                      disabled={isSubmitting}
                      autoFocus={!needsBinding}
                    />

                    {explorerUrl && (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="explorer-link"
                      >
                        View on Block Explorer ↗
                      </a>
                    )}

                    {error && <div className="error-message">{error}</div>}

                {/* TX_ALREADY_USED specific UI */}
                {txReuseError && (
                  <div className="tx-reuse-notice">
                    <h4>⚠️ Transaction Already Used</h4>
                    <p>
                      This transaction was already confirmed for payment{' '}
                      {txReuseError.originalTrackId && (
                        <code>#{txReuseError.originalTrackId.slice(0, 8)}...</code>
                      )}
                      {txReuseError.originalConfirmedAt && (
                        <span className="timestamp">
                          {' '}on {new Date(txReuseError.originalConfirmedAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                    {txReuseError.isWrongPayer && (
                      <div className="wrong-payer-detail">
                        <p><strong>Wallet Mismatch:</strong></p>
                        <p className="address-line">
                          <span className="label">Payment from:</span>{' '}
                          <code>
                            {txReuseError.payerAddress
                              ? `${txReuseError.payerAddress.slice(0, 6)}...${txReuseError.payerAddress.slice(-4)}`
                              : 'unknown'}
                          </code>
                        </p>
                        <p className="address-line">
                          <span className="label">Bound wallet:</span>{' '}
                          <code>
                            {txReuseError.boundAddress
                              ? `${txReuseError.boundAddress.slice(0, 6)}...${txReuseError.boundAddress.slice(-4)}`
                              : 'none'}
                          </code>
                        </p>
                      </div>
                    )}
                    <div className="cta-buttons">
                      <button className="cta-button rebind" onClick={handleRebind}>
                        Change Wallet
                      </button>
                      <button className="cta-button new-tx" onClick={() => setTxHash('')}>
                        Send New Payment
                      </button>
                    </div>
                  </div>
                )}

                {/* WRONG_PAYER specific UI */}
                {wrongPayerDetail && (
                  <div className="wrong-payer-notice">
                    <p>⚠️ Payment sent from different wallet than proven.</p>
                    {wrongPayerDetail.payerSource && (
                      <p className="payer-source">
                        Source: <span className="source-label">
                          {wrongPayerDetail.payerSource === 'tokenFrom' && 'ERC-20 Transfer event'}
                          {wrongPayerDetail.payerSource === 'txSender' && 'Transaction sender'}
                          {wrongPayerDetail.payerSource === 'txFrom' && 'Transaction sender (legacy)'}
                        </span>
                      </p>
                    )}
                    {wrongPayerDetail.payer && (
                      <p className="address-line">
                        <span className="label">Detected payer:</span>{' '}
                        <code>
                          {wrongPayerDetail.payer.slice(0, 6)}...{wrongPayerDetail.payer.slice(-4)}
                        </code>
                      </p>
                    )}
                    {wrongPayerDetail.tokenFrom && wrongPayerDetail.txSender && wrongPayerDetail.tokenFrom !== wrongPayerDetail.txSender && (
                      <div className="relayer-info">
                        <p><small>ℹ️ Payment used a relayer/router:</small></p>
                        <p className="address-line">
                          <span className="label">Token from:</span>{' '}
                          <code>{wrongPayerDetail.tokenFrom.slice(0, 6)}...{wrongPayerDetail.tokenFrom.slice(-4)}</code>
                        </p>
                        <p className="address-line">
                          <span className="label">Transaction sender:</span>{' '}
                          <code>{wrongPayerDetail.txSender.slice(0, 6)}...{wrongPayerDetail.txSender.slice(-4)}</code>
                        </p>
                      </div>
                    )}
                    {wrongPayerDetail.boundAddress && (
                      <p className="address-line">
                        <span className="label">Bound wallet:</span>{' '}
                        <code>
                          {wrongPayerDetail.boundAddress.slice(0, 6)}...{wrongPayerDetail.boundAddress.slice(-4)}
                        </code>
                      </p>
                    )}
                    <button className="rebind-button" onClick={handleRebind}>
                      Rebind Wallet
                    </button>
                  </div>
                )}

                    <div className="button-group">
                      <button
                        className="verify-button"
                        onClick={handleVerifyPayment}
                        disabled={isSubmitting || !txHash.trim() || retryAfter !== null}
                      >
                        {retryAfter !== null
                          ? `Please wait ${retryAfter}s`
                          : isSubmitting
                          ? 'Verifying...'
                          : 'Verify Payment'}
                      </button>

                      {error?.includes('expired') && (
                        <button className="refresh-button" onClick={handleRefresh}>
                          Refresh Challenge
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        <div className="payment-instructions">
          <details>
            <summary>How to pay</summary>
            <ol>
              {bindingRequired && (
                <>
                  <li>Connect your wallet (MetaMask, Coinbase Wallet, etc.)</li>
                  <li>Sign a message to prove wallet ownership (no gas fee)</li>
                </>
              )}
              <li>Send <strong>{formattedAmount}</strong> on <strong>{chainName}</strong> to the address above</li>
              <li>Copy the transaction hash from your wallet</li>
              <li>Paste it above and click "Verify Payment"</li>
            </ol>
          </details>

          {isLiveMode && !mocksEnabled && (
            <div className="mock-notice">
              <small>ℹ️ Mock payments are disabled in live mode. Real blockchain transactions required.</small>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 1rem;
        }

        .modal-content {
          background: #1a1a1a;
          border-radius: 8px;
          padding: 2rem;
          max-width: 500px;
          width: 100%;
          color: #fff;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
          max-height: 90vh;
          overflow-y: auto;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }

        .modal-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }

        .close-button {
          background: none;
          border: none;
          font-size: 2rem;
          color: #888;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          line-height: 1;
        }

        .close-button:hover {
          color: #fff;
        }

        .payment-details {
          background: #2a2a2a;
          border-radius: 6px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          gap: 1rem;
        }

        .detail-row:last-child {
          margin-bottom: 0;
        }

        .label {
          color: #aaa;
          font-size: 0.9rem;
        }

        .value {
          font-weight: 500;
        }

        .value.amount {
          font-size: 1.25rem;
          color: #4ade80;
        }

        .address-container {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex: 1;
          min-width: 0;
        }

        .address {
          font-family: monospace;
          font-size: 0.85rem;
          background: #1a1a1a;
          padding: 0.5rem;
          border-radius: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }

        .copy-button {
          background: #3a3a3a;
          border: none;
          color: #fff;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85rem;
          white-space: nowrap;
        }

        .copy-button:hover {
          background: #4a4a4a;
        }

        .countdown {
          font-family: monospace;
          font-size: 1.1rem;
        }

        .countdown.expired {
          color: #ef4444;
        }

        .expired-notice {
          background: #3a1a1a;
          border: 1px solid #ef4444;
          border-radius: 6px;
          padding: 1rem;
          margin-bottom: 1rem;
          text-align: center;
        }

        /* Wallet Binding Styles */
        .binding-section {
          background: #2a2a2a;
          border-radius: 6px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .binding-section h3 {
          margin: 0 0 1rem 0;
          font-size: 1.1rem;
          color: #4ade80;
        }

        .binding-description {
          color: #aaa;
          font-size: 0.9rem;
          margin-bottom: 1rem;
          line-height: 1.5;
        }

        .wallet-buttons {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .wallet-button {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s;
          font-weight: 500;
        }

        .wallet-button.metamask {
          background: #f6851b;
          color: #fff;
        }

        .wallet-button.metamask:hover:not(:disabled) {
          background: #e2761b;
        }

        .wallet-button.coinbase {
          background: #0052ff;
          color: #fff;
        }

        .wallet-button.coinbase:hover:not(:disabled) {
          background: #0041cc;
        }

        .wallet-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .bound-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1rem;
          padding: 0.75rem;
          background: #1a1a1a;
          border-radius: 4px;
        }

        .bound-address {
          font-family: monospace;
          font-size: 0.9rem;
          color: #4ade80;
          flex: 1;
        }

        .disconnect-button {
          background: #3a3a3a;
          border: none;
          color: #fff;
          padding: 0.5rem 0.75rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85rem;
        }

        .disconnect-button:hover {
          background: #4a4a4a;
        }

        .message-preview {
          margin-bottom: 1rem;
          background: #1a1a1a;
          border-radius: 4px;
          padding: 0.5rem;
        }

        .message-preview summary {
          cursor: pointer;
          color: #aaa;
          font-size: 0.85rem;
          padding: 0.5rem;
        }

        .message-preview pre {
          margin: 0.5rem 0 0 0;
          padding: 0.75rem;
          background: #0a0a0a;
          border-radius: 4px;
          font-size: 0.8rem;
          overflow-x: auto;
          white-space: pre-wrap;
          color: #ccc;
        }

        .prove-button {
          width: 100%;
          padding: 0.75rem 1.5rem;
          background: #4ade80;
          color: #000;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .prove-button:hover:not(:disabled) {
          background: #22c55e;
        }

        .prove-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .bound-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem;
          background: #1a3a1a;
          border: 1px solid #4ade80;
          border-radius: 4px;
          margin-bottom: 1rem;
          font-size: 0.9rem;
          color: #4ade80;
        }

        .bound-status code {
          font-family: monospace;
          background: #0a1a0a;
          padding: 0.25rem 0.5rem;
          border-radius: 3px;
        }

        .rebind-link {
          background: none;
          border: none;
          color: #4ade80;
          text-decoration: underline;
          cursor: pointer;
          font-size: 0.9rem;
          padding: 0;
          margin-left: auto;
        }

        .rebind-link:hover {
          color: #22c55e;
        }

        .tx-reuse-notice {
          background: #3a2a1a;
          border: 1px solid #f59e0b;
          border-radius: 4px;
          padding: 1rem;
          margin-top: 1rem;
        }

        .tx-reuse-notice h4 {
          margin: 0 0 0.75rem 0;
          color: #fbbf24;
          font-size: 1rem;
          font-weight: 600;
        }

        .tx-reuse-notice p {
          margin: 0 0 0.5rem 0;
          color: #fcd34d;
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .tx-reuse-notice code {
          font-family: monospace;
          background: #1a1a1a;
          padding: 0.2rem 0.4rem;
          border-radius: 3px;
          color: #4ade80;
        }

        .tx-reuse-notice .timestamp {
          color: #aaa;
          font-size: 0.85rem;
        }

        .tx-reuse-notice .wrong-payer-detail {
          background: #2a1a1a;
          border: 1px solid #ef4444;
          border-radius: 4px;
          padding: 0.75rem;
          margin: 0.75rem 0;
        }

        .tx-reuse-notice .wrong-payer-detail p {
          margin: 0 0 0.25rem 0;
          color: #fca5a5;
          font-size: 0.85rem;
        }

        .tx-reuse-notice .wrong-payer-detail .address-line {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .tx-reuse-notice .wrong-payer-detail .label {
          color: #aaa;
          font-size: 0.8rem;
        }

        .tx-reuse-notice .cta-buttons {
          display: flex;
          gap: 0.5rem;
          margin-top: 1rem;
        }

        .tx-reuse-notice .cta-button {
          flex: 1;
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9rem;
          font-weight: 600;
          transition: all 0.2s;
        }

        .tx-reuse-notice .cta-button.rebind {
          background: #4ade80;
          color: #000;
        }

        .tx-reuse-notice .cta-button.rebind:hover {
          background: #22c55e;
        }

        .tx-reuse-notice .cta-button.new-tx {
          background: #3b82f6;
          color: #fff;
        }

        .tx-reuse-notice .cta-button.new-tx:hover {
          background: #2563eb;
        }

        .wrong-payer-notice {
          background: #3a1a1a;
          border: 1px solid #ef4444;
          border-radius: 4px;
          padding: 1rem;
          margin-top: 1rem;
        }

        .wrong-payer-notice p {
          margin: 0 0 0.5rem 0;
          color: #fca5a5;
          font-size: 0.9rem;
        }

        .wrong-payer-notice .detail {
          font-family: monospace;
          font-size: 0.8rem;
          color: #aaa;
        }

        .rebind-button {
          margin-top: 0.75rem;
          padding: 0.5rem 1rem;
          background: #4ade80;
          color: #000;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9rem;
          font-weight: 600;
        }

        .rebind-button:hover {
          background: #22c55e;
        }

        .payment-form {
          margin-bottom: 1.5rem;
        }

        .wallet-connected {
          background: #2a2a2a;
          border-radius: 6px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .connected-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1rem;
          padding: 0.75rem;
          background: #1a1a1a;
          border-radius: 4px;
        }

        .address-display {
          font-family: monospace;
          font-size: 0.9rem;
          color: #4ade80;
          flex: 1;
        }

        .facilitator-notice {
          color: #aaa;
          font-size: 0.85rem;
          margin: 0;
          line-height: 1.5;
        }

        .sign-pay-button {
          width: 100%;
          padding: 1rem 1.5rem;
          background: #4ade80;
          color: #000;
          border: none;
          border-radius: 4px;
          font-size: 1.1rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 1rem;
        }

        .sign-pay-button:hover:not(:disabled) {
          background: #22c55e;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(74, 222, 128, 0.3);
        }

        .sign-pay-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .payment-form label {
          display: block;
          margin-bottom: 0.5rem;
          color: #aaa;
          font-size: 0.9rem;
        }

        .payment-form input {
          width: 100%;
          padding: 0.75rem;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #fff;
          font-family: monospace;
          font-size: 0.9rem;
        }

        .payment-form input:focus {
          outline: none;
          border-color: #4ade80;
        }

        .payment-form input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .explorer-link {
          display: inline-block;
          margin-top: 0.5rem;
          color: #4ade80;
          font-size: 0.85rem;
          text-decoration: none;
        }

        .explorer-link:hover {
          text-decoration: underline;
        }

        .error-message {
          background: #3a1a1a;
          border: 1px solid #ef4444;
          color: #fca5a5;
          padding: 0.75rem;
          border-radius: 4px;
          margin-top: 1rem;
          font-size: 0.9rem;
        }

        .button-group {
          display: flex;
          gap: 0.5rem;
          margin-top: 1rem;
        }

        .verify-button, .refresh-button {
          flex: 1;
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .verify-button {
          background: #4ade80;
          color: #000;
          font-weight: 600;
        }

        .verify-button:hover:not(:disabled) {
          background: #22c55e;
        }

        .verify-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .refresh-button {
          background: #3a3a3a;
          color: #fff;
        }

        .refresh-button:hover {
          background: #4a4a4a;
        }

        .payment-instructions {
          border-top: 1px solid #3a3a3a;
          padding-top: 1rem;
        }

        .payment-instructions details {
          color: #aaa;
        }

        .payment-instructions summary {
          cursor: pointer;
          font-size: 0.9rem;
          margin-bottom: 0.5rem;
        }

        .payment-instructions ol {
          margin: 0.5rem 0 0 1.5rem;
          padding: 0;
          font-size: 0.85rem;
          line-height: 1.6;
        }

        .payment-instructions strong {
          color: #fff;
        }

        .mock-notice {
          margin-top: 1rem;
          padding: 0.75rem;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          text-align: center;
        }

        .mock-notice small {
          color: #aaa;
          font-size: 0.85rem;
        }

        .facilitator-unavailable-notice {
          background: #3a2a1a;
          border: 1px solid #f59e0b;
          border-radius: 6px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .facilitator-unavailable-notice p {
          margin: 0 0 0.5rem 0;
          color: #fbbf24;
          font-size: 0.95rem;
          font-weight: 600;
        }

        .facilitator-unavailable-notice .fallback-description {
          color: #fcd34d;
          font-size: 0.85rem;
          font-weight: 400;
          line-height: 1.5;
        }

        .error {
          color: #ef4444;
        }

        @media (max-width: 600px) {
          .modal-content {
            padding: 1.5rem;
          }

          .detail-row {
            flex-direction: column;
            align-items: flex-start;
          }

          .address-container {
            width: 100%;
          }
        }
      `}</style>
    </div>
  )
}
