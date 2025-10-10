import type { Track } from '../../../types'

interface NowPlayingMetaProps {
  track: Track | null
  playheadSeconds: number
  className?: string
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60) // Use Math.floor to keep it clean
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function NowPlayingMeta({ track, playheadSeconds, className = '' }: NowPlayingMetaProps) {
  if (!track) {
    // Return a styled placeholder for the ticker
    return (
      <div className={`font-digital bg-black/70 border-2 border-black/80 rounded-md p-4 text-center text-2xl text-orange-400/50 shadow-[0_0_15px_rgba(251,146,60,0.5)] ${className}`}>
        Waiting for next track...
      </div>
    )
  }

  const progressPercent = track.duration_seconds > 0
    ? Math.min(100, (playheadSeconds / track.duration_seconds) * 100)
    : 0

  return (
    <div className={`font-digital bg-black/70 border-2 border-black/80 rounded-md p-4 text-orange-400 shadow-[0_0_15px_rgba(251,146,60,0.5)] ${className}`}>
      {/* Track Title and Artist */}
      <div className="text-center text-3xl tracking-wider mb-3">
        {track.prompt}
        {track.user && <span className="text-white/70"> - by {track.user.display_name}</span>}
      </div>

      {/* Progress Bar and Timings */}
      <div className="relative">
        {/* Timing info */}
        <div className="flex justify-between text-2xl mb-1">
          <span>{formatDuration(playheadSeconds)}</span>
          <span>{formatDuration(track.duration_seconds)}</span>
        </div>

        {/* Progress bar styled like the reference image */}
        <div className="w-full h-4 bg-orange-900/50 border border-black/50 rounded-full flex items-center p-0.5">
          <div className="h-full bg-orange-400 rounded-full" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    </div>
  )
}