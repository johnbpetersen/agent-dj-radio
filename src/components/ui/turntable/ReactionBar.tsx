import { useState, useEffect } from 'react'
import type { Track, ReactionKind } from '../../../types'

interface ReactionBarProps {
  track: Track | null
  userId: string | null
  onReactionSuccess: () => void
  className?: string
}

const reactionButtons = [
  { 
    kind: 'LOVE' as ReactionKind, 
    emoji: '❤️', 
    label: 'Love', 
    shortcut: 'L',
    color: 'from-red-400 to-pink-500',
    hoverColor: 'hover:from-red-500 hover:to-pink-600'
  },
  { 
    kind: 'FIRE' as ReactionKind, 
    emoji: '🔥', 
    label: 'Fire', 
    shortcut: 'F',
    color: 'from-orange-400 to-red-500',
    hoverColor: 'hover:from-orange-500 hover:to-red-600'
  },
  { 
    kind: 'SKIP' as ReactionKind, 
    emoji: '⏭️', 
    label: 'Skip', 
    shortcut: 'S',
    color: 'from-gray-400 to-gray-600',
    hoverColor: 'hover:from-gray-500 hover:to-gray-700'
  }
]

export default function ReactionBar({ track, userId, onReactionSuccess, className = '' }: ReactionBarProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string>('')

  const submitReaction = async (kind: ReactionKind) => {
    if (!track || !userId || isSubmitting) return

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

      const reactionButton = reactionButtons.find(btn => btn.kind === kind)
      setFeedback(`${reactionButton?.emoji} ${reactionButton?.label} sent!`)
      onReactionSuccess()
      
      // Clear feedback after 2 seconds
      setTimeout(() => setFeedback(''), 2000)
    } catch (error) {
      console.error('Failed to submit reaction:', error)
      setError(error instanceof Error ? error.message : 'Failed to submit reaction')
      setTimeout(() => setError(null), 3000)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (!track || !userId || isSubmitting) return
      
      // Only trigger if not in an input field
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const key = event.key.toLowerCase()
      const reactionButton = reactionButtons.find(btn => btn.shortcut.toLowerCase() === key)
      
      if (reactionButton) {
        event.preventDefault()
        submitReaction(reactionButton.kind)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [track, userId, isSubmitting])

  if (!track) {
    return (
      <div className={`glass-card p-4 text-center ${className}`}>
        <div className="text-white/60">No track to react to</div>
        <div className="text-white/40 text-sm mt-1">Queue a track to start the party!</div>
      </div>
    )
  }

  if (!userId) {
    return (
      <div className={`glass-card p-4 text-center ${className}`}>
        <div className="text-white/60">Queue a track to join the reactions!</div>
      </div>
    )
  }

  return (
    <div className={`glass-card p-4 ${className}`}>
      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Feedback Display */}
      <div className="h-6 mb-4" aria-live="polite">
        {feedback && (
          <div className="text-center text-green-300 font-medium smooth-appear">
            {feedback}
          </div>
        )}
      </div>

      {/* Reaction Buttons */}
      <div className="flex gap-3">
        {reactionButtons.map(({ kind, emoji, label, shortcut, color, hoverColor }) => (
          <button
            key={kind}
            onClick={() => submitReaction(kind)}
            disabled={isSubmitting}
            className={`
              reaction-btn flex-1 py-4 px-3
              bg-gradient-to-br ${color} ${hoverColor}
              text-white font-bold rounded-xl
              shadow-lg border border-white/20
              transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-white/50
              disabled:opacity-50 disabled:cursor-not-allowed
              group
            `}
            title={`${label} (Press ${shortcut})`}
          >
            <div className="text-3xl mb-2 group-hover:scale-110 transition-transform duration-200">
              {emoji}
            </div>
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs opacity-70 mt-1">
              Press {shortcut}
            </div>
          </button>
        ))}
      </div>

      {/* Keyboard shortcut hint */}
      <div className="text-center text-white/40 text-xs mt-3">
        Use keyboard shortcuts: L • F • S
      </div>

      {/* Loading indicator */}
      {isSubmitting && (
        <div className="flex items-center justify-center mt-4 text-white/60">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white/60"></div>
          <span className="ml-2 text-sm">Sending reaction...</span>
        </div>
      )}
    </div>
  )
}