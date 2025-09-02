import type { Track } from '../../../types'

interface NowPlayingMetaProps {
  track: Track | null
  playheadSeconds: number
  className?: string
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatTimeLeft(currentSeconds: number, totalSeconds: number): string {
  const remaining = Math.max(0, totalSeconds - currentSeconds)
  return formatDuration(remaining)
}

export default function NowPlayingMeta({ track, playheadSeconds, className = '' }: NowPlayingMetaProps) {
  if (!track) {
    return (
      <div className={`text-center ${className}`}>
        <div className="glass-card p-6">
          <div className="text-white/60 text-lg">No track playing</div>
          <div className="text-white/40 text-sm mt-2">Queue a track to get the party started!</div>
        </div>
      </div>
    )
  }

  const progressPercent = track.duration_seconds > 0 
    ? Math.min(100, (playheadSeconds / track.duration_seconds) * 100)
    : 0

  // Determine if title is too long for marquee effect
  const isLongTitle = track.prompt.length > 50

  return (
    <div className={`${className}`}>
      <div className="text-center mb-4">
        {/* Track Title */}
        <div className="relative mb-2">
          <div 
            className={`
              text-2xl md:text-3xl font-bold text-white 
              ${isLongTitle ? 'overflow-hidden' : ''}
            `}
            style={isLongTitle ? { height: '2.5rem' } : {}}
          >
            <div className={isLongTitle ? 'marquee whitespace-nowrap' : ''}>
              {track.prompt}
            </div>
          </div>
        </div>
        
        {/* Artist/Submitter */}
        {track.user && (
          <div className="text-white/70 text-lg mb-2">
            by {track.user.display_name}
          </div>
        )}
        
        {/* Duration and time info */}
        <div className="flex items-center justify-center gap-4 text-white/60 text-sm">
          <span>{formatDuration(playheadSeconds)}</span>
          <span>•</span>
          <span>{formatDuration(track.duration_seconds)}</span>
          <span>•</span>
          <span>{formatTimeLeft(playheadSeconds, track.duration_seconds)} left</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative">
        <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
          <div 
            className="h-full bg-gradient-to-r from-blue-400 to-purple-500 rounded-full transition-all duration-1000 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        
        {/* Rating display */}
        {track.rating_count > 0 && (
          <div className="flex items-center justify-center mt-3 text-white/70 text-sm">
            <span className="flex items-center gap-2">
              ⭐ {track.rating_score.toFixed(1)} 
              <span className="text-white/50">({track.rating_count} reactions)</span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}