import { useState } from 'react'
import type { Track, ReactionKind } from '../../../types'

interface ReactionBarProps {
  track: Track | null
  userId: string | null
  onReactionSuccess: () => void
  className?: string
}

// Button styles are now defined here for a cleaner look
const buttonStyles = {
  LOVE: 'bg-green-500 hover:bg-green-400 shadow-[0_0_15px_rgba(34,197,94,0.7)]',
  FIRE: 'bg-red-500 hover:bg-red-400 shadow-[0_0_15px_rgba(239,68,68,0.7)]',
  SKIP: 'bg-blue-500 hover:bg-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.7)]',
}

const reactionButtons = [
  { kind: 'LOVE' as ReactionKind, label: 'AWESOME' },
  { kind: 'FIRE' as ReactionKind, label: 'LAME' }, // Example mapping
  // We can add the third button back later if needed. Turntable had Awesome/Lame.
]

export default function ReactionBar({ track, userId, onReactionSuccess, className = '' }: ReactionBarProps) {
  const [isSubmitting, setIsSubmitting] = useState<ReactionKind | null>(null)
  
  const submitReaction = async (kind: ReactionKind) => {
    if (!track || !userId || isSubmitting) return
    setIsSubmitting(kind)

    try {
      const response = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: track.id, user_id: userId, kind })
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }
      onReactionSuccess()
    } catch (error) {
      console.error('Failed to submit reaction:', error)
    } finally {
      // Add a small delay to show feedback
      setTimeout(() => setIsSubmitting(null), 500)
    }
  }
  
  // No need to render anything if no track, as the parent component handles layout
  if (!track || !userId) {
    return <div className={`h-16 ${className}`} />; // Return empty space
  }

  return (
    <div className={`flex items-center justify-center gap-8 ${className}`}>
      {reactionButtons.map(({ kind, label }) => (
        <div key={kind} className="flex flex-col items-center gap-2">
          <button
            onClick={() => submitReaction(kind)}
            disabled={!!isSubmitting}
            className={`
              w-16 h-16 rounded-full border-2 border-black/50
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              ${buttonStyles[kind]}
              ${isSubmitting === kind ? 'scale-110' : 'scale-100 hover:scale-105'}
            `}
          />
          <div className="text-white/80 font-bold text-sm">{label}</div>
        </div>
      ))}
    </div>
  )
}