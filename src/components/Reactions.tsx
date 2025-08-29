import { useState } from 'react'
import type { Track, ReactionKind, ReactionResponse } from '../types'

interface ReactionsProps {
  track: Track | null
  userId: string | null
  onReactionSuccess: () => void
}

const reactionButtons = [
  { kind: 'LOVE' as ReactionKind, label: '❤️', title: 'Love' },
  { kind: 'FIRE' as ReactionKind, label: '🔥', title: 'Fire' },
  { kind: 'SKIP' as ReactionKind, label: '⏭️', title: 'Skip' }
]

export default function Reactions({ track, userId, onReactionSuccess }: ReactionsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitReaction = async (kind: ReactionKind) => {
    if (!track || !userId) return

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_id: track.id,
          user_id: userId,
          kind
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const result: ReactionResponse = await response.json()
      onReactionSuccess()
    } catch (error) {
      console.error('Failed to submit reaction:', error)
      setError(error instanceof Error ? error.message : 'Failed to submit reaction')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!track) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Reactions</h2>
        <p className="text-gray-600 text-center py-4">
          No track playing to react to
        </p>
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Reactions</h2>
        <p className="text-gray-600 text-center py-4">
          Enter your name in the submit form to react to tracks
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4">React to This Track</h2>
      
      <div className="mb-4">
        <h3 className="font-medium text-gray-900 mb-1">{track.prompt}</h3>
        {track.user && (
          <p className="text-sm text-gray-600">by {track.user.display_name}</p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      <div className="flex gap-3 mb-4">
        {reactionButtons.map(({ kind, label, title }) => (
          <button
            key={kind}
            onClick={() => submitReaction(kind)}
            disabled={isSubmitting}
            className="flex-1 py-3 px-4 text-2xl bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            title={title}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="text-center text-sm text-gray-600">
        {track.rating_count > 0 ? (
          <p>
            Current rating: <strong>{track.rating_score?.toFixed(1)}</strong> from {track.rating_count} reactions
          </p>
        ) : (
          <p>Be the first to react to this track!</p>
        )}
      </div>

      {isSubmitting && (
        <div className="mt-4 text-center">
          <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-sm text-gray-600">Submitting reaction...</span>
        </div>
      )}
    </div>
  )
}