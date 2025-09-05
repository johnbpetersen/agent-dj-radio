import { useRef, useEffect, useState, useMemo } from 'react'
import type { Track } from '../types'

interface NowPlayingProps {
  track: Track | null
  playheadSeconds: number
  isLoading: boolean
  onAdvance: () => void
}

const DEBUG = false // Flip true briefly if you need logs

export default function NowPlaying({ track, playheadSeconds, isLoading, onAdvance }: NowPlayingProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [displaySeconds, setDisplaySeconds] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasUserInteracted, setHasUserInteracted] = useState(false)
  const [useLocalTest, setUseLocalTest] = useState(false)
  const [useProxy, setUseProxy] = useState(false)
  const lastSecondRef = useRef<number>(-1)

  // Build the src only when it truly changes
  const src = useMemo(() => {
    if (!track?.audio_url) return ''
    
    if (useLocalTest) {
      return '/sample-track.wav'
    } else if (useProxy) {
      return `/api/audio-proxy?url=${encodeURIComponent(track.audio_url)}`
    } else {
      return track.audio_url
    }
  }, [track?.audio_url, useLocalTest, useProxy])

  // Attach stable event handlers exactly once per <audio> mount
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !src) return

    // Initialize to server playhead if there's large drift (do this once on mount)
    const drift = Math.abs(audio.currentTime - (playheadSeconds || 0))
    if (playheadSeconds >= 0 && drift > 2) {
      audio.currentTime = playheadSeconds
      lastSecondRef.current = Math.floor(playheadSeconds)
      setDisplaySeconds(Math.floor(playheadSeconds))
    }

    const onTimeUpdate = () => {
      const s = Math.floor(audio.currentTime)
      if (s !== lastSecondRef.current) {
        lastSecondRef.current = s
        setDisplaySeconds(s)
        
        // Check if track finished
        if (track && audio.currentTime >= track.duration_seconds && audio.currentTime > 0) {
          onAdvance()
        }
      }
    }

    const onPlaying = () => {
      setIsPlaying(true)
      if (DEBUG) console.log('playing @', audio.currentTime.toFixed(2))
    }

    const onPause = () => {
      setIsPlaying(false)
      if (DEBUG) console.log('pause @', audio.currentTime.toFixed(2))
    }

    const onWaiting = () => {
      if (DEBUG) console.log('waiting/buffering @', audio.currentTime.toFixed(2))
    }

    const onEnded = () => {
      setIsPlaying(false)
      onAdvance()
    }

    const onError = () => {
      setIsPlaying(false)
      if (DEBUG) console.log('audio error', {
        err: audio.error, ready: audio.readyState, net: audio.networkState
      })
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
    // IMPORTANT: run only when the actual <audio> element remounts (keyed by track id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, track?.id])

  const handleUserInteraction = async () => {
    setHasUserInteracted(true)
    const audio = audioRef.current
    if (!audio) return

    try {
      const playPromise = audio.play()
      if (playPromise) {
        await playPromise
      }
      setIsPlaying(true)
    } catch (error) {
      if (DEBUG) console.error('Play failed:', error)
      setIsPlaying(false)
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

  // Key by track id so a new element mounts on song change (no leftover listeners/state)
  const audioKey = track?.id ?? 'none'

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

      {/* Clean audio element - key ensures clean mount on track change */}
      <audio
        key={audioKey}
        ref={audioRef}
        src={src || undefined}
        crossOrigin="anonymous"
        preload="auto"
        controls
        className="w-full mb-4"
      />

      {/* DEBUG: Show test controls */}
      <div className="mb-4 p-2 bg-gray-100 rounded">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs text-gray-600">DEBUG Controls</p>
          <div className="flex space-x-1">
            <button
              onClick={() => setUseLocalTest(!useLocalTest)}
              className={`px-2 py-1 text-xs rounded ${
                useLocalTest 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-300 text-gray-700'
              }`}
            >
              {useLocalTest ? 'Using Local' : 'Local Test'}
            </button>
            <button
              onClick={() => setUseProxy(!useProxy)}
              className={`px-2 py-1 text-xs rounded ${
                useProxy 
                  ? 'bg-purple-500 text-white' 
                  : 'bg-gray-300 text-gray-700'
              }`}
              disabled={useLocalTest}
            >
              {useProxy ? 'Using Proxy' : 'Use Proxy'}
            </button>
          </div>
        </div>
        {track.audio_url && (
          <p className="text-xs text-gray-500 break-all">
            Original: {track.audio_url}
          </p>
        )}
        {useLocalTest && (
          <p className="text-xs text-blue-600">🧪 Testing: /sample-track.wav</p>
        )}
        {useProxy && !useLocalTest && (
          <p className="text-xs text-purple-600">🔄 Using proxy</p>
        )}
      </div>

      {/* Time UI driven only by displaySeconds */}
      {track && (
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>{Math.floor(displaySeconds / 60)}:{String(displaySeconds % 60).padStart(2, '0')}</span>
            <span>{Math.floor(track.duration_seconds / 60)}:{String(track.duration_seconds % 60).padStart(2, '0')}</span>
            <span>
              {(() => {
                const remaining = Math.max(0, track.duration_seconds - displaySeconds)
                return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} left`
              })()}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-[width] duration-1000 ease-linear"
              style={{ width: track ? `${Math.min(100, (displaySeconds / track.duration_seconds) * 100)}%` : '0%' }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0:00</span>
            <span>{Math.floor(track.duration_seconds / 60)}:{String(track.duration_seconds % 60).padStart(2, '0')}</span>
          </div>
        </div>
      )}

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