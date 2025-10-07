// src/components/PaymentModal.tsx
// Payment modal for x402 challenge fulfillment

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
    }
  }
}

/**
 * Convert unknown error types to readable string
 * Handles Response, Error, structured error objects, and unknown types
 * Never returns "[object Object]" - always a readable string
 */
async function toErrorString(x: unknown): Promise<string> {
  // Handle Response objects
  if (x instanceof Response) {
    try {
      const data = await x.json()
      return toErrorStringSync(data)
    } catch {
      // JSON parse failed, try text
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

/**
 * Synchronous version for non-Response errors
 */
function toErrorStringSync(x: unknown): string {
  // Handle structured error object
  if (x && typeof x === 'object' && 'error' in x) {
    const errObj = (x as any).error
    const code = errObj?.code || 'UNKNOWN'
    const message = errObj?.message || 'An error occurred'
    const hint = errObj?.hint

    // Format fields array if present (for VALIDATION_ERROR)
    if (Array.isArray(errObj?.fields) && errObj.fields.length > 0) {
      const fieldMessages = errObj.fields
        .map((f: any) => `${f.path}: ${f.message}`)
        .join(', ')
      return hint
        ? `${code}: ${message} (${fieldMessages}) - ${hint}`
        : `${code}: ${message} (${fieldMessages})`
    }

    return hint ? `${code}: ${message} - ${hint}` : `${code}: ${message}`
  }

  // Handle Error instances
  if (x instanceof Error) {
    return x.message
  }

  // Handle plain string
  if (typeof x === 'string') {
    return x
  }

  // Handle top-level message property
  if (x && typeof x === 'object' && 'message' in x && typeof (x as any).message === 'string') {
    return (x as any).message
  }

  // Last resort: try JSON.stringify but cap length
  if (x && typeof x === 'object') {
    try {
      const str = JSON.stringify(x)
      return str.length <= 200 ? str : str.substring(0, 197) + '...'
    } catch {
      return 'An unexpected error occurred'
    }
  }

  // Absolute fallback
  return String(x) || 'An unexpected error occurred'
}

export function PaymentModal({ challenge, onSuccess, onRefresh, onClose }: PaymentModalProps) {
  // Safe guard: if no challenge provided, show error
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

  const [txHash, setTxHash] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [copied, setCopied] = useState(false)
  const [isLiveMode, setIsLiveMode] = useState(false)
  const [mocksEnabled, setMocksEnabled] = useState(true)
  const [retryAfter, setRetryAfter] = useState<number | null>(null) // Rate limit countdown

  // Fetch feature flags on mount (cached by browser for 60s)
  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then((data: HealthResponse) => {
        const x402Enabled = data.features?.x402?.enabled ?? false
        const mockEnabled = data.features?.x402?.mockEnabled ?? true
        setIsLiveMode(x402Enabled)
        setMocksEnabled(mockEnabled)
      })
      .catch(err => {
        console.warn('Failed to fetch health flags:', err)
        // Default to safe mode (assume live, hide mocks)
        setIsLiveMode(true)
        setMocksEnabled(false)
      })
  }, [])

  // Initialize countdown from challenge prop
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

  // Countdown timer for rate limit retry
  useEffect(() => {
    if (retryAfter === null) return

    const interval = setInterval(() => {
      setRetryAfter(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval)
          // Re-enable button by setting isSubmitting to false
          setIsSubmitting(false)
          setError(null)
          return null
        }
        // Update error message with new countdown
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

    // Disable button immediately to prevent double-submit
    setIsSubmitting(true)
    setError(null)

    // Debug log for development
    const payload = {
      challengeId: challenge.challengeId,
      txHash: txHash.trim()
    }
    console.debug('[confirm] payload', payload)

    try {
      const response = await fetch('/api/queue/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      // Handle 429 (rate limited) specially
      if (response.status === 429) {
        // Read Retry-After header or compute from X-RateLimit-Reset
        let retrySeconds = 30 // Default fallback

        const retryAfterHeader = response.headers.get('Retry-After')
        if (retryAfterHeader) {
          retrySeconds = parseInt(retryAfterHeader, 10)
        } else {
          const resetHeader = response.headers.get('X-RateLimit-Reset')
          if (resetHeader) {
            const resetTime = parseInt(resetHeader, 10) * 1000 // Convert to ms
            retrySeconds = Math.ceil((resetTime - Date.now()) / 1000)
          }
        }

        // Start countdown
        setRetryAfter(retrySeconds)
        setError(`RATE_LIMITED: Please wait ${retrySeconds}s`)
        return
      }

      // Parse response (handle malformed JSON gracefully)
      let data: any
      try {
        data = await response.json()
      } catch (jsonError) {
        // Couldn't parse JSON, use toErrorString on the response
        const errorText = await toErrorString(response)
        setError(errorText)
        return
      }

      if (!response.ok) {
        // Use toErrorString helper to extract error message (never "[object Object]")
        const baseError = toErrorStringSync(data)

        // Enhance with context-specific hints based on error code
        const errorCode = data.error?.code || 'UNKNOWN'
        let displayError = baseError

        switch (errorCode) {
          case 'WRONG_ASSET':
            displayError = `${baseError} (Expected: ${challenge.asset})`
            break
          case 'WRONG_CHAIN':
            displayError = `${baseError} (Expected: ${getChainDisplayName(challenge.chain)})`
            break
          case 'NO_MATCH':
            displayError = `${baseError} (Check transaction hash)`
            break
          case 'DB_ERROR':
            displayError = `${baseError} (Database error - please try again)`
            break
          case 'INTERNAL':
            displayError = `${baseError} (Server error - please contact support)`
            break
          case 'VALIDATION_ERROR':
            // Already formatted with fields by toErrorStringSync
            displayError = baseError
            break
        }

        setError(displayError)
        return
      }

      // Success!
      if (data.ok && data.trackId) {
        onSuccess(data.trackId)
      } else {
        setError('Payment verified but track ID not returned')
      }
    } catch (err) {
      console.error('Payment verification error:', err)
      // Use toErrorString helper for all error types
      const errorMsg = toErrorStringSync(err)
      setError(`Network error: ${errorMsg}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRefresh = () => {
    onRefresh()
    onClose()
  }

  const isExpired = countdown <= 0
  const formattedAmount = formatUSDCAmount(challenge.amount)
  const chainName = getChainDisplayName(challenge.chain)
  const explorerUrl = txHash && validateTxHash(txHash) ? getBlockExplorerUrl(challenge.chain, txHash) : null

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
          <div className="payment-form">
            <label htmlFor="txHash">
              Transaction Hash:
            </label>
            <input
              id="txHash"
              type="text"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="0x..."
              disabled={isSubmitting}
              autoFocus
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
          </div>
        )}

        <div className="payment-instructions">
          <details>
            <summary>How to pay</summary>
            <ol>
              <li>Copy the payment address above</li>
              <li>Open your wallet (e.g., MetaMask, Coinbase Wallet)</li>
              <li>Send <strong>{formattedAmount}</strong> on <strong>{chainName}</strong> to the address</li>
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

      <style jsx>{`
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

        .payment-form {
          margin-bottom: 1.5rem;
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
