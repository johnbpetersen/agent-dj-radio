import { useState } from 'react'
import { useEphemeralUser } from '../hooks/useEphemeralUser'
import { parseXPaymentHeader, type ParsedXPayment } from '../lib/x402-utils'
import { PaymentModal } from './PaymentModal'
import type { PriceQuoteResponse, SubmitTrackResponse } from '../types'

interface SubmitFormProps {
  onSubmitSuccess: () => void
}

const DURATION_OPTIONS = [60, 90, 120] as const

export default function SubmitForm({ onSubmitSuccess }: SubmitFormProps) {
  const { user, loading: userLoading, error: userError, rename } = useEphemeralUser()
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState<60 | 90 | 120>(120)
  const [tempDisplayName, setTempDisplayName] = useState('')
  const [priceQuote, setPriceQuote] = useState<PriceQuoteResponse | null>(null)
  const [parsedChallenge, setParsedChallenge] = useState<ParsedXPayment | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGettingQuote, setIsGettingQuote] = useState(false)
  const [isSettingName, setIsSettingName] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // User readiness for form interactions
  const isUserReady = !userLoading && !!user
  const needsDisplayName = !user && !userLoading

  const handleSetDisplayName = async () => {
    if (!tempDisplayName.trim()) {
      setError('Please enter your name')
      return
    }

    setIsSettingName(true)
    setError(null)

    const success = await rename(tempDisplayName.trim())
    if (success) {
      setTempDisplayName('')
    }
    
    setIsSettingName(false)
  }

  const getPriceQuote = async () => {
    if (!prompt.trim() || !isUserReady) {
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
        // Handle x402 payment challenge - parse X-PAYMENT header
        const xPaymentHeader = response.headers.get('X-PAYMENT')
        if (!xPaymentHeader) {
          setError('Payment required but no payment details provided')
          return
        }

        const challenge = parseXPaymentHeader(xPaymentHeader)
        if (!challenge) {
          setError('Invalid payment challenge format')
          return
        }

        // Debug log for development
        console.debug('[submit] parsed challenge', challenge)

        setParsedChallenge(challenge)
        setShowPaymentModal(true)
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

  const handlePaymentSuccess = (trackId: string) => {
    console.debug('[submit] payment confirmed, trackId:', trackId)

    // Reset form and close modal
    setPrompt('')
    setPriceQuote(null)
    setParsedChallenge(null)
    setShowPaymentModal(false)
    setError(null)

    onSubmitSuccess()
  }

  const handlePaymentRefresh = () => {
    console.debug('[submit] payment challenge refresh requested')

    // Re-submit to get new challenge
    setParsedChallenge(null)
    setShowPaymentModal(false)
    submitTrack()
  }

  const handlePaymentClose = () => {
    console.debug('[submit] payment modal closed')

    // Keep challenge in case user wants to continue
    setShowPaymentModal(false)
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

        {userLoading && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-blue-800 text-sm">
              Initializing user session...
            </p>
          </div>
        )}

        {(error || userError) && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-red-800 text-sm">{error || userError}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={getPriceQuote}
            disabled={isGettingQuote || !prompt.trim() || !isUserReady}
            className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGettingQuote ? 'Getting Quote...' : 'Get Price Quote'}
          </button>

          {priceQuote && user && (
            <button
              onClick={submitTrack}
              disabled={isSubmitting || !prompt.trim() || !isUserReady}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Submitting...' : `Submit for $${priceQuote.price_usd.toFixed(2)}`}
            </button>
          )}
        </div>

        {priceQuote && !parsedChallenge && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-blue-800 text-sm">
              Price quote: <strong>${priceQuote.price_usd.toFixed(2)}</strong> for {priceQuote.duration_seconds} seconds
            </p>
            <p className="text-blue-600 text-xs mt-1">
              Complete payment to add track to queue
            </p>
          </div>
        )}

        {parsedChallenge && (
          <div className="bg-orange-50 border border-orange-200 rounded-md p-3">
            <p className="text-orange-800 text-sm">
              ⏳ Payment challenge ready. Click "Reopen Payment" to continue.
            </p>
            <button
              onClick={() => setShowPaymentModal(true)}
              className="mt-2 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 text-sm"
            >
              Reopen Payment
            </button>
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && parsedChallenge && (
        <PaymentModal
          challenge={parsedChallenge}
          onSuccess={handlePaymentSuccess}
          onRefresh={handlePaymentRefresh}
          onClose={handlePaymentClose}
        />
      )}
    </div>
  )
}