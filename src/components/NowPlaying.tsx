import { useRef, useEffect } from 'react'
import type { Track } from '../types'

interface NowPlayingProps {
  track: Track | null
  playheadSeconds: number
  isLoading: boolean
  onAdvance: () => void
}

export default function NowPlaying({ track, playheadSeconds, isLoading, onAdvance }: NowPlayingProps) {
  const audioRef = useRef<HTMLAudioElement>(null)

  // Update audio element when track changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track?.audio_url) return

    audio.src = track.audio_url
    audio.currentTime = playheadSeconds
    audio.play().catch(console.error)

    return () => {
      audio.pause()
    }
  }, [track?.id, track?.audio_url])

  // Sync playhead with audio element
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track) return

    const targetTime = playheadSeconds
    const actualTime = audio.currentTime
    const drift = Math.abs(targetTime - actualTime)

    // Resync if drift is more than 2 seconds
    if (drift > 2 && !audio.seeking) {
      audio.currentTime = targetTime
    }
  }, [playheadSeconds, track])

  // Auto-advance when track ends
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleEnded = () => {
      onAdvance()
    }

    audio.addEventListener('ended', handleEnded)
    return () => audio.removeEventListener('ended', handleEnded)
  }, [onAdvance])

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
          <div className="h-2 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  if (!track) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 text-center">
        <h2 className="text-xl font-bold text-gray-800 mb-2">No Track Playing</h2>
        <p className="text-gray-600">Queue up a track to get the music started!</p>
        <button
          onClick={onAdvance}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Check for Tracks
        </button>
      </div>
    )
  }

  const progressPercent = (playheadSeconds / track.duration_seconds) * 100
  const remainingSeconds = Math.max(0, track.duration_seconds - playheadSeconds)
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-800 mb-2">Now Playing</h2>
        <p className="text-lg text-gray-700 font-medium">{track.prompt}</p>
        {track.user && (
          <p className="text-sm text-gray-500 mt-1">by {track.user.display_name}</p>
        )}
      </div>

      <audio ref={audioRef} />

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>{Math.floor(playheadSeconds / 60)}:{(playheadSeconds % 60).toString().padStart(2, '0')}</span>
          <span>-{minutes}:{seconds.toString().padStart(2, '0')}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-1000"
            style={{ width: `${Math.min(100, progressPercent)}%` }}
          />
        </div>
      </div>

      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-600">
          {track.source === 'REPLAY' && (
            <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs">
              REPLAY
            </span>
          )}
        </div>
        <div className="text-sm text-gray-600">
          {track.rating_count > 0 && (
            <span>★ {track.rating_score?.toFixed(1)} ({track.rating_count})</span>
          )}
        </div>
      </div>
    </div>
  )
}