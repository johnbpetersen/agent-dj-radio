import { useState } from 'react'
import { useUser } from '../hooks/useUser'
import type { PriceQuoteResponse, SubmitTrackResponse, X402Challenge, X402ChallengeResponse, X402ConfirmRequest, X402ConfirmResponse } from '../types'

interface SubmitFormProps {
  onSubmitSuccess: () => void
}

const DURATION_OPTIONS = [60, 90, 120] as const

export default function SubmitForm({ onSubmitSuccess }: SubmitFormProps) {
  const { user, isLoading: userLoading, error: userError, setDisplayName } = useUser()
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState<60 | 90 | 120>(120)
  const [tempDisplayName, setTempDisplayName] = useState('')
  const [priceQuote, setPriceQuote] = useState<PriceQuoteResponse | null>(null)
  const [paymentChallenge, setPaymentChallenge] = useState<X402Challenge | null>(null)
  const [trackId, setTrackId] = useState<string | null>(null)
  const [paymentProof, setPaymentProof] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGettingQuote, setIsGettingQuote] = useState(false)
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false)
  const [isSettingName, setIsSettingName] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsDisplayName = !user && !userLoading

  const handleSetDisplayName = async () => {
    if (!tempDisplayName.trim()) {
      setError('Please enter your name')
      return
    }

    setIsSettingName(true)
    setError(null)

    const success = await setDisplayName(tempDisplayName.trim())
    if (success) {
      setTempDisplayName('')
    }
    
    setIsSettingName(false)
  }

  const getPriceQuote = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt first')
      return
    }

    setIsGettingQuote(true)
    setError(null)

    try {
      const response = await fetch('/api/queue/price-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_seconds: duration })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const quote: PriceQuoteResponse = await response.json()
      setPriceQuote(quote)
    } catch (error) {
      console.error('Failed to get price quote:', error)
      setError('Failed to get price quote')
    } finally {
      setIsGettingQuote(false)
    }
  }

  const submitTrack = async () => {
    if (!prompt.trim() || !user) {
      setError('Please fill in all fields and set your name')
      return
    }

    if (!priceQuote) {
      setError('Please get a price quote first')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      // Submit track with existing user
      const response = await fetch('/api/queue/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          duration_seconds: duration,
          user_id: user.id
        })
      })

      if (response.status === 402) {
        // Handle x402 payment challenge
        const challengeData: X402ChallengeResponse = await response.json()
        setPaymentChallenge(challengeData.challenge)
        setTrackId(challengeData.track_id)
        setError(null)
        return
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const result: SubmitTrackResponse = await response.json()
      
      // Reset form (keep user)
      setPrompt('')
      setPriceQuote(null)
      setError(null)
      
      onSubmitSuccess()
    } catch (error) {
      console.error('Failed to submit track:', error)
      setError(error instanceof Error ? error.message : 'Failed to submit track')
    } finally {
      setIsSubmitting(false)
    }
  }

  const confirmPayment = async () => {
    if (!trackId || !paymentProof.trim()) {
      setError('Please provide payment proof')
      return
    }

    setIsConfirmingPayment(true)
    setError(null)

    try {
      const confirmRequest: X402ConfirmRequest = {
        track_id: trackId,
        payment_proof: paymentProof.trim()
      }

      const response = await fetch('/api/queue/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmRequest)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const result: X402ConfirmResponse = await response.json()

      if (!result.payment_verified) {
        throw new Error('Payment verification failed')
      }

      // Reset form completely (keep user)
      setPrompt('')
      setPriceQuote(null)
      setPaymentChallenge(null)
      setTrackId(null)
      setPaymentProof('')
      setError(null)

      onSubmitSuccess()
    } catch (error) {
      console.error('Failed to confirm payment:', error)
      setError(error instanceof Error ? error.message : 'Failed to confirm payment')
    } finally {
      setIsConfirmingPayment(false)
    }
  }

  const generateMockPayment = async () => {
    if (!paymentChallenge || !trackId) {
      setError('No payment challenge available')
      return
    }

    try {
      // Generate a mock payment proof for testing
      const mockProof = {
        transaction_hash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
        amount: paymentChallenge.amount,
        asset: paymentChallenge.asset,
        chain: paymentChallenge.chain,
        payTo: paymentChallenge.payTo,
        nonce: paymentChallenge.nonce,
        block_number: Math.floor(Math.random() * 1000000) + 5000000,
        timestamp: Date.now(),
        proof_type: 'base_sepolia_mock'
      }

      const mockPaymentProof = btoa(JSON.stringify(mockProof))
      setPaymentProof(mockPaymentProof)
      setError(null)
    } catch (error) {
      console.error('Failed to generate mock payment:', error)
      setError('Failed to generate mock payment')
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4">Submit a Track</h2>
      
      <div className="space-y-4">
        {needsDisplayName ? (
          <div>
            <label htmlFor="tempDisplayName" className="block text-sm font-medium text-gray-700 mb-2">
              What's your name?
            </label>
            <div className="flex gap-2">
              <input
                id="tempDisplayName"
                type="text"
                value={tempDisplayName}
                onChange={(e) => setTempDisplayName(e.target.value)}
                placeholder="Enter your display name"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && !isSettingName && handleSetDisplayName()}
              />
              <button
                onClick={handleSetDisplayName}
                disabled={isSettingName || !tempDisplayName.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSettingName ? 'Setting...' : 'Set Name'}
              </button>
            </div>
          </div>
        ) : user ? (
          <div className="bg-green-50 border border-green-200 rounded-md p-3">
            <p className="text-green-800 text-sm">
              <strong>Signed in as:</strong> {user.display_name}
            </p>
          </div>
        ) : null}

        <div>
          <label htmlFor="prompt" className="block text-sm font-medium text-gray-700 mb-2">
            Track Prompt
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the song you want generated..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div>
          <label htmlFor="duration" className="block text-sm font-medium text-gray-700 mb-2">
            Duration
          </label>
          <select
            id="duration"
            value={duration}
            onChange={(e) => {
              setDuration(Number(e.target.value) as 60 | 90 | 120)
              setPriceQuote(null) // Reset quote when duration changes
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {DURATION_OPTIONS.map(d => (
              <option key={d} value={d}>
                {d} seconds ({Math.floor(d / 60)}:{(d % 60).toString().padStart(2, '0')})
              </option>
            ))}
          </select>
        </div>

        {(error || userError) && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-red-800 text-sm">{error || userError}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={getPriceQuote}
            disabled={isGettingQuote || !prompt.trim() || !user}
            className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGettingQuote ? 'Getting Quote...' : 'Get Price Quote'}
          </button>

          {priceQuote && user && (
            <button
              onClick={submitTrack}
              disabled={isSubmitting || !prompt.trim() || !user}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Submitting...' : `Submit for $${priceQuote.price_usd.toFixed(2)}`}
            </button>
          )}
        </div>

        {priceQuote && !paymentChallenge && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-blue-800 text-sm">
              Price quote: <strong>${priceQuote.price_usd.toFixed(2)}</strong> for {priceQuote.duration_seconds} seconds
            </p>
            <p className="text-blue-600 text-xs mt-1">
              Complete payment to add track to queue
            </p>
          </div>
        )}

        {paymentChallenge && (
          <div className="bg-orange-50 border border-orange-200 rounded-md p-4">
            <h3 className="font-semibold text-orange-800 mb-2">Payment Required</h3>
            <div className="text-sm text-orange-700 space-y-2">
              <p>
                <strong>Amount:</strong> {(parseInt(paymentChallenge.amount) / 1000000).toFixed(2)} {paymentChallenge.asset}
              </p>
              <p>
                <strong>Pay to:</strong> <code className="bg-orange-100 px-1 rounded text-xs">{paymentChallenge.payTo}</code>
              </p>
              <p>
                <strong>Chain:</strong> {paymentChallenge.chain}
              </p>
              <p>
                <strong>Expires:</strong> {new Date(paymentChallenge.expiresAt).toLocaleString()}
              </p>
            </div>
            
            <div className="mt-4">
              <label htmlFor="paymentProof" className="block text-sm font-medium text-orange-700 mb-2">
                Payment Proof
              </label>
              <textarea
                id="paymentProof"
                value={paymentProof}
                onChange={(e) => setPaymentProof(e.target.value)}
                placeholder="Enter your payment proof (base64 encoded transaction data)"
                rows={3}
                className="w-full px-3 py-2 border border-orange-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={generateMockPayment}
                  className="px-3 py-1 bg-gray-500 text-white rounded-md hover:bg-gray-600 text-sm"
                >
                  Generate Mock Payment
                </button>
                <button
                  onClick={confirmPayment}
                  disabled={isConfirmingPayment || !paymentProof.trim()}
                  className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isConfirmingPayment ? 'Confirming...' : 'Confirm Payment'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}