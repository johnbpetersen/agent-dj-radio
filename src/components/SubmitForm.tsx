import { useState } from 'react'
import type { PriceQuoteResponse, SubmitTrackResponse } from '../types'

interface SubmitFormProps {
  onSubmitSuccess: () => void
}

const DURATION_OPTIONS = [60, 90, 120] as const

export default function SubmitForm({ onSubmitSuccess }: SubmitFormProps) {
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState<60 | 90 | 120>(120)
  const [userDisplayName, setUserDisplayName] = useState('')
  const [priceQuote, setPriceQuote] = useState<PriceQuoteResponse | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGettingQuote, setIsGettingQuote] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    if (!prompt.trim() || !userDisplayName.trim()) {
      setError('Please fill in all fields')
      return
    }

    if (!priceQuote) {
      setError('Please get a price quote first')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      // Create user if needed (simplified for Sprint 1)
      const userResponse = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: userDisplayName.trim() })
      })

      if (!userResponse.ok) {
        const errorData = await userResponse.json()
        throw new Error(errorData.error || 'Failed to create user')
      }

      const userData = await userResponse.json()
      const userId = userData.user.id

      // Submit track
      const response = await fetch('/api/queue/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          duration_seconds: duration,
          user_id: userId
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const result: SubmitTrackResponse = await response.json()
      
      // Reset form
      setPrompt('')
      setUserDisplayName('')
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

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4">Submit a Track</h2>
      
      <div className="space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
            Your Name
          </label>
          <input
            id="displayName"
            type="text"
            value={userDisplayName}
            onChange={(e) => setUserDisplayName(e.target.value)}
            placeholder="Enter your display name"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

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

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={getPriceQuote}
            disabled={isGettingQuote || !prompt.trim()}
            className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGettingQuote ? 'Getting Quote...' : 'Get Price Quote'}
          </button>

          {priceQuote && (
            <button
              onClick={submitTrack}
              disabled={isSubmitting || !prompt.trim() || !userDisplayName.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Submitting...' : `Submit for $${priceQuote.price_usd.toFixed(2)}`}
            </button>
          )}
        </div>

        {priceQuote && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-blue-800 text-sm">
              Price quote: <strong>${priceQuote.price_usd.toFixed(2)}</strong> for {priceQuote.duration_seconds} seconds
            </p>
            <p className="text-blue-600 text-xs mt-1">
              Complete payment to add track to queue
            </p>
          </div>
        )}
      </div>
    </div>
  )
}