import { useState } from 'react'
import type { Track } from '../../../types'
import Avatar from './Avatar'

interface QueuePanelProps {
  queue: Track[]
  isLoading: boolean
  className?: string
}

interface QueueTrackProps {
  track: Track
  position: number
  isNext: boolean
}

function QueueTrack({ track, position, isNext }: QueueTrackProps) {
  const estimatedMinutesToPlay = position * 1.5 // Rough estimate

  return (
    <div className={`
      p-3 rounded-lg border transition-all duration-300
      ${isNext 
        ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-400/30 shadow-lg' 
        : 'bg-white/5 border-white/10 hover:bg-white/10'
      }
    `}>
      <div className="flex items-center gap-3">
        {/* Position & Avatar */}
        <div className="flex-shrink-0 flex items-center gap-2">
          <div className={`
            w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
            ${isNext ? 'bg-blue-500 text-white' : 'bg-white/20 text-white/70'}
          `}>
            {position + 1}
          </div>
          <Avatar 
            name={track.user?.display_name || 'Unknown'} 
            size="sm"
          />
        </div>
        
        {/* Track Info */}
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium text-sm truncate">
            {track.prompt}
          </div>
          <div className="flex items-center gap-2 text-white/60 text-xs mt-1">
            <span>{track.user?.display_name || 'Unknown'}</span>
            <span>•</span>
            <span>{track.duration_seconds}s</span>
            {!isNext && estimatedMinutesToPlay > 0 && (
              <>
                <span>•</span>
                <span>~{Math.round(estimatedMinutesToPlay)}m</span>
              </>
            )}
          </div>
        </div>
        
        {/* Status Badge */}
        <div className="flex-shrink-0">
          <div className={`
            px-2 py-1 rounded text-xs font-medium
            ${track.status === 'READY' ? 'bg-green-500/20 text-green-300' :
              track.status === 'PAID' ? 'bg-blue-500/20 text-blue-300' :
              track.status === 'GENERATING' ? 'bg-yellow-500/20 text-yellow-300' :
              'bg-gray-500/20 text-gray-300'}
          `}>
            {track.status === 'GENERATING' ? 'GEN' : 
             track.status === 'READY' ? 'READY' :
             track.status === 'PAID' ? 'PAID' : track.status}
          </div>
        </div>
        
        {/* Next up indicator */}
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

function EmptyQueue() {
  return (
    <div className="text-center py-12">
      <div className="text-6xl mb-4 opacity-20">🎵</div>
      <div className="text-white/60 font-medium mb-2">Queue is empty</div>
      <div className="text-white/40 text-sm">
        Submit a track to keep the music playing!
      </div>
    </div>
  )
}

function LoadingQueue() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="p-3 rounded-lg bg-white/5">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 bg-white/10 rounded-full"></div>
              <div className="w-8 h-8 bg-white/10 rounded-full"></div>
              <div className="flex-1">
                <div className="h-4 bg-white/10 rounded mb-2"></div>
                <div className="h-3 bg-white/5 rounded w-2/3"></div>
              </div>
              <div className="w-12 h-6 bg-white/10 rounded"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function QueuePanel({ queue, isLoading, className = '' }: QueuePanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  // Filter and sort queue - show READY, PAID, GENERATING tracks
  const relevantQueue = queue
    .filter(track => ['READY', 'PAID', 'GENERATING'].includes(track.status))
    .sort((a, b) => {
      // Sort by status priority: READY -> PAID -> GENERATING
      const statusOrder = { 'READY': 1, 'PAID': 2, 'GENERATING': 3 }
      return (statusOrder[a.status as keyof typeof statusOrder] || 99) - 
             (statusOrder[b.status as keyof typeof statusOrder] || 99)
    })

  const displayQueue = isExpanded ? relevantQueue : relevantQueue.slice(0, 5)
  const hasMore = relevantQueue.length > 5

  return (
    <div className={`glass-card ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">Up Next</h2>
            {relevantQueue.length > 0 && (
              <span className="bg-blue-500/20 text-blue-300 text-xs px-2 py-1 rounded-full">
                {relevantQueue.length}
              </span>
            )}
          </div>
          
          {/* Mobile toggle button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="md:hidden text-white/60 hover:text-white p-1"
            aria-label="Toggle queue"
          >
            <svg 
              className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
      
      {/* Queue Content */}
      <div className={`
        transition-all duration-300 overflow-hidden
        ${isExpanded || window.innerWidth >= 768 ? 'max-h-full' : 'max-h-0 md:max-h-full'}
      `}>
        <div className="p-4">
          {isLoading ? (
            <LoadingQueue />
          ) : relevantQueue.length === 0 ? (
            <EmptyQueue />
          ) : (
            <>
              <div className="space-y-3">
                {displayQueue.map((track, index) => (
                  <QueueTrack
                    key={track.id}
                    track={track}
                    position={index}
                    isNext={index === 0}
                  />
                ))}
              </div>
              
              {/* Show more button */}
              {hasMore && !isExpanded && (
                <button
                  onClick={() => setIsExpanded(true)}
                  className="w-full mt-4 py-2 text-white/60 hover:text-white text-sm transition-colors"
                >
                  Show {relevantQueue.length - 5} more tracks...
                </button>
              )}
              
              {/* Show less button */}
              {isExpanded && hasMore && (
                <button
                  onClick={() => setIsExpanded(false)}
                  className="w-full mt-4 py-2 text-white/60 hover:text-white text-sm transition-colors"
                >
                  Show less
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}