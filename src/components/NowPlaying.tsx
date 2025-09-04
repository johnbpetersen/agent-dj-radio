import { useRef, useEffect, useState } from 'react'
import type { Track } from '../types'

interface NowPlayingProps {
  track: Track | null
  playheadSeconds: number
  isLoading: boolean
  onAdvance: () => void
}

export default function NowPlaying({ track, playheadSeconds, isLoading, onAdvance }: NowPlayingProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [localPlayheadSeconds, setLocalPlayheadSeconds] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasUserInteracted, setHasUserInteracted] = useState(false)

  // Update local playhead smoothly every 100ms
  useEffect(() => {
    if (!isPlaying || !track) return

    const interval = setInterval(() => {
      setLocalPlayheadSeconds(prev => {
        const newTime = prev + 0.1
        // Auto-advance when track finishes
        if (newTime >= track.duration_seconds) {
          console.log('Track finished, advancing...')
          onAdvance()
          return prev
        }
        return newTime
      })
    }, 100)

    return () => clearInterval(interval)
  }, [isPlaying, track, onAdvance])

  // Sync with server playhead periodically
  useEffect(() => {
    setLocalPlayheadSeconds(playheadSeconds)
  }, [playheadSeconds])

  // Handle track changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track?.audio_url) {
      setIsPlaying(false)
      setLocalPlayheadSeconds(0)
      return
    }

    console.log('Loading new track:', track.prompt, track.audio_url)
    audio.src = track.audio_url
    audio.currentTime = playheadSeconds
    setLocalPlayheadSeconds(playheadSeconds)

    // Try to autoplay, but handle browser restrictions
    const attemptPlay = async () => {
      try {
        await audio.play()
        setIsPlaying(true)
        console.log('Audio started playing')
      } catch (error) {
        console.log('Autoplay blocked, need user interaction:', error)
        setIsPlaying(false)
      }
    }

    if (hasUserInteracted) {
      attemptPlay()
    }

    // Keep audio element in sync with local playhead
    const syncInterval = setInterval(() => {
      if (audio && !audio.paused && Math.abs(audio.currentTime - localPlayheadSeconds) > 1) {
        audio.currentTime = localPlayheadSeconds
      }
    }, 1000)

    return () => {
      clearInterval(syncInterval)
      audio.pause()
      setIsPlaying(false)
    }
  }, [track?.id, track?.audio_url, playheadSeconds, hasUserInteracted])

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handlePlay = () => {
      setIsPlaying(true)
      console.log('Audio play event')
    }

    const handlePause = () => {
      setIsPlaying(false)
      console.log('Audio pause event')
    }

    const handleEnded = () => {
      console.log('Audio ended event')
      setIsPlaying(false)
      onAdvance()
    }

    const handleError = (e: Event) => {
      console.error('Audio error:', e)
      setIsPlaying(false)
    }

    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
  }, [onAdvance])

  // Handle user interaction to enable autoplay
  const handleUserInteraction = async () => {
    setHasUserInteracted(true)
    const audio = audioRef.current
    if (audio && track?.audio_url && !isPlaying) {
      try {
        audio.currentTime = localPlayheadSeconds
        await audio.play()
        setIsPlaying(true)
        console.log('Manual play successful')
      } catch (error) {
        console.error('Manual play failed:', error)
      }
    }
  }

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

  const currentSeconds = Math.floor(localPlayheadSeconds)
  const progressPercent = (localPlayheadSeconds / track.duration_seconds) * 100
  const remainingSeconds = Math.max(0, track.duration_seconds - currentSeconds)
  const currentMinutes = Math.floor(currentSeconds / 60)
  const currentSecondsDisplay = currentSeconds % 60
  const remainingMinutes = Math.floor(remainingSeconds / 60)
  const remainingSecondsDisplay = remainingSeconds % 60

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="mb-4">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Now Playing</h2>
            <p className="text-lg text-gray-700 font-medium">{track.prompt}</p>
            {track.user && (
              <p className="text-sm text-gray-500 mt-1">by {track.user.display_name}</p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {!isPlaying && track.audio_url && (
              <button
                onClick={handleUserInteraction}
                className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600 transition-colors"
              >
                ▶ Play
              </button>
            )}
            {isPlaying && (
              <span className="text-green-500 text-sm flex items-center">
                <span className="animate-pulse mr-1">●</span> Playing
              </span>
            )}
          </div>
        </div>
      </div>

      <audio ref={audioRef} />

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>{currentMinutes}:{currentSecondsDisplay.toString().padStart(2, '0')}</span>
          <span>-{remainingMinutes}:{remainingSecondsDisplay.toString().padStart(2, '0')}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-100"
            style={{ width: `${Math.min(100, progressPercent)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0:00</span>
          <span>{Math.floor(track.duration_seconds / 60)}:{(track.duration_seconds % 60).toString().padStart(2, '0')}</span>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-600">
          {track.source === 'REPLAY' && (
            <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs">
              REPLAY
            </span>
          )}
          {!hasUserInteracted && (
            <span className="text-orange-600 text-xs ml-2">Click play to enable audio</span>
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