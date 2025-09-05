import { useRef, useEffect, useState } from 'react'
import type { Track } from '../types'

interface NowPlayingProps {
  track: Track | null
  playheadSeconds: number
  isLoading: boolean
  onAdvance: () => void
}

// Helper function to check how many seconds of audio are buffered ahead
function getBufferedAhead(audio: HTMLAudioElement): number {
  const currentTime = audio.currentTime
  for (let i = 0; i < audio.buffered.length; i++) {
    const start = audio.buffered.start(i)
    const end = audio.buffered.end(i)
    if (currentTime >= start && currentTime <= end) {
      return end - currentTime
    }
  }
  return 0
}

const MIN_BUFFER_AHEAD_SECONDS = 8 // Require 8 seconds buffered before starting playback

export default function NowPlaying({ track, playheadSeconds, isLoading, onAdvance }: NowPlayingProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentPlayheadSeconds, setCurrentPlayheadSeconds] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasUserInteracted, setHasUserInteracted] = useState(false)
  const [isAudioLoaded, setIsAudioLoaded] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [useLocalTest, setUseLocalTest] = useState(false)
  const [useProxy, setUseProxy] = useState(false)
  const lastSecondRef = useRef<number>(-1)

  // SMART BUFFERING: Set up audio element with proper buffer management
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track?.audio_url) {
      setIsPlaying(false)
      setCurrentPlayheadSeconds(0)
      setIsBuffering(false)
      return
    }

    // Choose audio source: local test, proxy, or direct remote URL
    let audioUrl: string
    if (useLocalTest) {
      audioUrl = '/sample-track.wav'
    } else if (useProxy && track.audio_url) {
      audioUrl = `/api/audio-proxy?url=${encodeURIComponent(track.audio_url)}`
    } else {
      audioUrl = track.audio_url
    }
    console.log('🎵 Setting up audio with smart buffering:', { 
      useLocalTest, 
      audioUrl,
      originalUrl: track.audio_url 
    })

    // CRITICAL: Set crossOrigin before src to avoid CORS issues
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audio.autoplay = false
    audio.src = audioUrl

    // Reset state
    setIsAudioLoaded(false)
    setIsBuffering(false)
    setCurrentPlayheadSeconds(0)
    lastSecondRef.current = -1

    const onLoadedData = () => {
      console.log('🎵 Audio data loaded')
      setIsAudioLoaded(true)
    }

    const onWaiting = () => {
      console.log('🎵 Audio waiting/buffering...')
      setIsBuffering(true)
    }

    const onPlaying = () => {
      console.log('🎵 Audio playing, stopping buffer indicator')
      setIsBuffering(false)
    }

    const onCanPlay = () => {
      console.log('🎵 Audio can play (basic readiness)')
    }

    const onCanPlayThrough = () => {
      console.log('🎵 Audio can play through (enough buffered)')
    }

    // CRITICAL: Use timeupdate for smooth, reliable timer updates
    const onTimeUpdate = () => {
      const currentTime = audio.currentTime
      const currentSecond = Math.floor(currentTime)
      
      // Only update state when the second actually changes (reduces re-renders)
      if (currentSecond !== lastSecondRef.current) {
        lastSecondRef.current = currentSecond
        setCurrentPlayheadSeconds(currentTime)
        
        // Check if track finished
        if (track && currentTime >= track.duration_seconds && currentTime > 0) {
          console.log('🎵 Track finished, advancing...')
          onAdvance()
        }
      }
    }

    const onEnded = () => {
      console.log('🎵 Audio ended')
      setIsPlaying(false)
      onAdvance()
    }

    const onError = (e: Event) => {
      console.error('🎵 Audio error:', e, {
        error: audio.error,
        networkState: audio.networkState,
        readyState: audio.readyState,
        src: audio.src,
      })
      setIsPlaying(false)
      setIsBuffering(false)
    }

    // Add all event listeners
    audio.addEventListener('loadeddata', onLoadedData)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('canplaythrough', onCanPlayThrough)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    // Let browser handle loading naturally (don't force .load())

    return () => {
      audio.pause()
      audio.removeEventListener('loadeddata', onLoadedData)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('canplaythrough', onCanPlayThrough)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [track?.id, track?.audio_url, useLocalTest, useProxy, onAdvance])

  // Sync with server playhead when track changes or on big drift
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track || playheadSeconds < 0) return

    const drift = Math.abs(audio.currentTime - playheadSeconds)
    if (drift > 2) {
      console.log(`🎵 Syncing to server time: ${playheadSeconds}s (drift: ${drift}s)`)
      audio.currentTime = playheadSeconds
      setCurrentPlayheadSeconds(playheadSeconds)
      lastSecondRef.current = Math.floor(playheadSeconds)
    }
  }, [track?.id, playheadSeconds])

  // SMART PLAY: Wait for adequate buffer before starting playback
  const handleUserInteraction = async () => {
    console.log('🎵 User clicked play - checking buffer before starting...')
    setHasUserInteracted(true)
    
    const audio = audioRef.current
    if (!audio || !track?.audio_url) {
      console.error('🎵 No audio element or URL available')
      return
    }

    try {
      // Wait until we have adequate buffer OR canplaythrough OR timeout
      const deadline = Date.now() + 7000 // 7 second safety timeout
      let attempts = 0
      
      while (Date.now() < deadline) {
        const bufferedAhead = getBufferedAhead(audio)
        const readyState = audio.readyState
        
        console.log(`🎵 Buffer check attempt ${++attempts}: ${bufferedAhead.toFixed(1)}s buffered, readyState: ${readyState}`)
        
        // Good to go if we have enough buffer or browser says ready
        if ((readyState >= 3 && bufferedAhead >= MIN_BUFFER_AHEAD_SECONDS) || readyState >= 4) {
          console.log('🎵 ✅ Sufficient buffer available, starting playback')
          break
        }
        
        // Give browser time to buffer more data
        await new Promise(resolve => setTimeout(resolve, 150))
      }

      // Sync playhead if needed
      if (currentPlayheadSeconds > 0) {
        audio.currentTime = currentPlayheadSeconds
      }

      // Start playback
      const playPromise = audio.play()
      if (playPromise) {
        await playPromise
      }
      
      setIsPlaying(true)
      console.log('🎵 ✅ Playback started successfully!', {
        bufferedAhead: getBufferedAhead(audio).toFixed(1) + 's',
        currentTime: audio.currentTime.toFixed(1) + 's',
        readyState: audio.readyState
      })
      
    } catch (error) {
      console.error('🎵 ❌ Playback failed:', error)
      setIsPlaying(false)
      setIsBuffering(false)
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

  const currentSeconds = Math.floor(currentPlayheadSeconds)
  const progressPercent = (currentPlayheadSeconds / track.duration_seconds) * 100
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
            {isPlaying && !isBuffering && (
              <span className="text-green-500 text-sm flex items-center">
                <span className="animate-pulse mr-1">●</span> Playing
              </span>
            )}
            {isBuffering && (
              <span className="text-orange-500 text-sm flex items-center">
                <span className="animate-spin mr-1">⟳</span> Buffering...
              </span>
            )}
          </div>
        </div>
      </div>

      {/* DEBUG: Show audio controls for testing */}
      <div className="mb-4 p-2 bg-gray-100 rounded">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs text-gray-600">
            DEBUG: Audio Element {!isAudioLoaded && '(Loading...)'}
          </p>
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
        <audio 
          ref={audioRef} 
          controls 
          preload="auto"
          crossOrigin="anonymous"
          className="w-full" 
        />
        {track.audio_url && (
          <p className="text-xs text-gray-500 mt-1 break-all">
            Original URL: {track.audio_url}
          </p>
        )}
        {useLocalTest && (
          <p className="text-xs text-blue-600 mt-1">
            🧪 Testing with: /sample-track.wav
          </p>
        )}
        {useProxy && !useLocalTest && (
          <p className="text-xs text-purple-600 mt-1">
            🔄 Using proxy: /api/audio-proxy
          </p>
        )}
        <div className="text-xs text-gray-500 mt-1">
          Status: {isPlaying ? 'Playing' : 'Paused'} | 
          Loaded: {isAudioLoaded ? 'Yes' : 'No'} |
          Buffering: {isBuffering ? 'Yes' : 'No'} |
          Time: {currentPlayheadSeconds.toFixed(1)}s
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>{currentMinutes}:{currentSecondsDisplay.toString().padStart(2, '0')}</span>
          <span>-{remainingMinutes}:{remainingSecondsDisplay.toString().padStart(2, '0')}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-1000 ease-linear"
            style={{ 
              width: `${Math.min(100, progressPercent)}%`
            }}
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