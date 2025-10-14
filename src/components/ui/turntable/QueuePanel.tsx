import type { Track } from '../../../types'
import Avatar from './Avatar'
import UserChip from '../UserChip'

// This is a sub-component for a single track in the new list style.
function QueueTrack({ track, position, isNext }: { track: Track, position: number, isNext: boolean }) {
  return (
    <div className={`
      p-3 rounded-lg transition-all duration-300
      ${isNext ? 'bg-blue-500/20' : 'hover:bg-white/10'}
    `}>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 text-white/60 w-5 text-center">{position + 1}</div>
        <Avatar
          name={track.user?.display_name || 'Unknown'}
          size="sm"
        />
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium text-sm truncate">{track.prompt}</div>
          {/* Attribution line - compact */}
          <div className="flex items-center gap-2 text-white/60 text-xs mt-1">
            <UserChip
              userId={track.submitter_user_id}
              fallbackName={track.user?.display_name}
              className="text-white/70"
            />
            {track.payer_user_id && track.payer_user_id !== track.submitter_user_id && (
              <>
                <span>→</span>
                <span className="text-[10px]">💰</span>
                <UserChip
                  userId={track.payer_user_id}
                  fallbackName={null}
                  className="text-white/70"
                />
              </>
            )}
          </div>
        </div>
        {isNext && (
          <div className="flex-shrink-0">
            <div className="bg-yellow-400 text-yellow-900 text-xs px-2 py-1 rounded-full font-bold">
              UP NEXT
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Main component, refactored for the new dark theme.
export default function QueuePanel({ queue, isLoading, className = '' }: { queue: Track[], isLoading: boolean, className?: string }) {
  // We keep only the relevant queue logic
  const relevantQueue = queue.filter(track => ['READY', 'PAID', 'GENERATING'].includes(track.status))

  return (
    // The "glass-card" is gone. The background now comes from the SidePanel.
    <div className={`text-white ${className}`}>
      <div className="p-4">
        {isLoading ? (
          // Simple loading state
          <div className="text-center text-white/60 p-8">Loading...</div>
        ) : relevantQueue.length === 0 ? (
          // Simple empty state
          <div className="text-center text-white/60 p-8">The queue is empty.</div>
        ) : (
          <div className="space-y-2">
            {relevantQueue.map((track, index) => (
              <QueueTrack
                key={track.id}
                track={track}
                position={index}
                isNext={index === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}