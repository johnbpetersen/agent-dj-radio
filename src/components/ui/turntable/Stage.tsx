import { useRef, useEffect } from 'react'
import type { Track } from '../../../types'
import Avatar from './Avatar'
import NowPlayingMeta from './NowPlayingMeta'

interface StageProps {
  track: Track | null
  playheadSeconds: number
  isLoading: boolean
  className?: string
  onAdvance?: () => void
}

// EQ Bars Component
function EQVisualizer({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className={`flex items-end justify-center gap-1 h-12 ${isPlaying ? 'eq-playing' : ''}`}>
      <div className="eq-bar" />
      <div className="eq-bar" />
      <div className="eq-bar" />
      <div className="eq-bar" />
      <div className="eq-bar" />
    </div>
  )
}

// DJ Booth Component
function DJBooth({ track }: { track: Track | null }) {
  if (!track || !track.user) {
    return (
      <div className="glass-card p-4 text-center">
        <div className="flex flex-col items-center gap-3">
          <Avatar name="DJ" size="lg" />
          <div className="text-white/60">
            <div className="text-sm font-medium">DJ Booth</div>
            <div className="text-xs">Waiting for track...</div>
          </div>
        </div>
      </div>
    )
  }

  const isPlaying = track.status === 'PLAYING'

  return (
    <div className="glass-card p-4">
      <div className="flex flex-col items-center gap-3">
        {/* DJ Avatar */}
        <div className="relative">
          <Avatar 
            name={track.user.display_name} 
            size="xl" 
            isDJ={true}
            isOnline={isPlaying}
          />
        </div>
        
        {/* DJ Info */}
        <div className="text-center text-white">
          <div className="font-bold text-lg">{track.user.display_name}</div>
          <div className="text-white/70 text-sm">Current DJ</div>
          
          {/* On Air Pill */}
          {isPlaying && (
            <div className="mt-2">
              <span className="on-air-pill inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-lg">
                🔴 ON AIR
              </span>
            </div>
          )}
        </div>
        
        {/* EQ Visualizer */}
        <div className="mt-2">
          <EQVisualizer isPlaying={isPlaying} />
        </div>
      </div>
    </div>
  )
}

// Circular Progress Ring
function ProgressRing({ 
  progress, 
  size = 200 
}: { 
  progress: number
  size?: number 
}) {
  const center = size / 2
  const radius = center - 8
  const circumference = 2 * Math.PI * radius
  const strokeDasharray = `${(progress / 100) * circumference} ${circumference}`

  return (
    <div className="relative">
      <svg width={size} height={size} className="progress-ring">
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth="8"
        />
        {/* Progress circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="url(#progressGradient)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={strokeDasharray}
          className="transition-all duration-1000 ease-linear"
        />
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
      </svg>
      
      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="text-2xl font-bold">{Math.round(progress)}%</div>
          <div className="text-sm text-white/70">Complete</div>
        </div>
      </div>
    </div>
  )
}

export default function Stage({ track, playheadSeconds, isLoading, className = '', onAdvance }: StageProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  
  // Simple, reliable gate: WebAudio is OFF by default everywhere.
  // Turn it on only when you explicitly opt-in via .env.
  const allowWebCtx = import.meta.env.VITE_ENABLE_WEBCTX === 'true';
  
  // Debug logging for component props
  if (import.meta.env.DEV) {
    console.log('[Stage] render', { 
      track: track ? { 
        id: track.id, 
        status: track.status, 
        audio_url: track.audio_url,
        prompt: track.prompt 
      } : null, 
      playheadSeconds, 
      isLoading,
      allowWebCtx
    });
  }
  
  const progressPercent = track?.duration_seconds 
    ? Math.min(100, (playheadSeconds / track.duration_seconds) * 100)
    : 0

  // Make audio element globally accessible for autoplay unlock
  useEffect(() => {
    if (audioRef.current) {
      (window as any).__audioElement = audioRef.current
      
      // Add test functions for debugging
      if (import.meta.env.DEV) {
        (window as any).__testAudio = () => {
          const a = audioRef.current;
          if (a) {
            console.log('[Stage] Audio test:', {
              src: a.src,
              paused: a.paused,
              muted: a.muted,
              volume: a.volume,
              readyState: a.readyState,
              duration: a.duration,
              currentTime: a.currentTime
            });
          } else {
            console.log('[Stage] No audio element found');
          }
        };
        
        (window as any).__playAudio = async () => {
          const a = audioRef.current;
          if (a && a.src) {
            try {
              a.muted = false;
              a.volume = 1;
              await a.play();
              console.log('[Stage] Manual play successful');
            } catch (e) {
              console.error('[Stage] Manual play failed:', e);
            }
          } else {
            console.log('[Stage] No audio to play');
          }
        };
        
        // Comprehensive audio debugging helper
        (window as any).__dumpAudio = () => {
          const a = audioRef.current;
          const ctx = (window as any).__adrAudioCtx;
          if (!a) return 'no audio element';
          return {
            src: a.currentSrc,
            paused: a.paused,
            muted: a.muted,
            volume: a.volume,
            currentTime: a.currentTime,
            readyState: a.readyState, // 4 == HAVE_ENOUGH_DATA
            webctxAllowed: allowWebCtx,
            webctxActive: !!((window as any).__adrSrcNode),
            webctxDisabled: !!((window as any).__adrWebAudioDisabled),
            ctxState: ctx?.state
          };
        };

        // Force disable WebAudio and fallback to plain audio
        (window as any).__disableWebAudio = () => {
          const a = audioRef.current;
          if ((window as any).__adrSrcNode) {
            try {
              (window as any).__adrSrcNode.disconnect();
              delete (window as any).__adrSrcNode;
            } catch {}
          }
          (window as any).__adrWebAudioDisabled = true;
          if (a) {
            a.play().catch(() => {});
          }
          console.log('[Audio] WebAudio manually disabled, using plain <audio>');
        };
        
        console.log('[Audio] Debug functions: __dumpAudio(), __disableWebAudio(), __testAudio(), __playAudio()');
      }
    }
  }, [])

  // Unlock: play() first; only build WebAudio when explicitly allowed
  useEffect(() => {
    (window as any).__adrUnlockAudio = async () => {
      const a = audioRef.current;
      if (!a) {
        console.warn('[Stage] unlock: audioRef missing');
        return;
      }
      
      try {
        a.muted = false;
        a.volume = 1;
        await a.play().catch(() => {});
        
        if (allowWebCtx) {
          const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (Ctx) {
            let ctx = (window as any).__adrAudioCtx as AudioContext | undefined;
            if (!ctx) { 
              ctx = new Ctx(); 
              (window as any).__adrAudioCtx = ctx;
            }
            if (ctx.state !== 'running') await ctx.resume().catch(() => {});
            
            let srcNode = (window as any).__adrSrcNode as MediaElementAudioSourceNode | undefined;
            if (!srcNode) {
              srcNode = (window as any).__adrSrcNode = ctx.createMediaElementSource(a);
              srcNode.connect(ctx.destination);
              console.log('[Audio] WebAudio chain: MediaElementSource → destination');
            }
          }
        }
        console.log('[Stage] unlock ok');
      } catch (err) {
        console.warn('[Stage] unlock failed', err);
      }
    };
    
    return () => { delete (window as any).__adrUnlockAudio; };
  }, [allowWebCtx]);

  // Set src when track changes, don't play yet
  useEffect(() => {
    const a = audioRef.current;
    if (!a) {
      if (import.meta.env.DEV) console.log('[Stage] audio ref not available');
      return;
    }
    
    if (import.meta.env.DEV) console.log('[Stage] track changed', { track, hasAudioUrl: !!track?.audio_url });
    
    const url =
      (track?.audio_url && track.audio_url.trim()) ||
      ((track as any)?.audioUrl && (track as any).audioUrl.trim()) ||
      '';
    
    if (!url) {
      if (import.meta.env.DEV) console.log('[Stage] no audio URL found', { track });
      return;
    }
    
    if (a.src !== url) {
      a.crossOrigin = 'anonymous';
      a.src = url;
      a.load();
      if (import.meta.env.DEV) console.log('[Stage] set src', { url, readyState: a.readyState });
    }
  }, [track?.audio_url, (track as any)?.audioUrl]);

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
    if (!audio || !onAdvance) return

    const handleEnded = () => {
      onAdvance()
    }

    audio.addEventListener('ended', handleEnded)
    return () => audio.removeEventListener('ended', handleEnded)
  }, [onAdvance])

  if (isLoading) {
    return (
      <div className={`glass-card p-8 text-center ${className}`}>
        <div className="animate-pulse">
          <div className="w-48 h-48 bg-white/10 rounded-full mx-auto mb-6"></div>
          <div className="h-8 bg-white/10 rounded mb-4"></div>
          <div className="h-4 bg-white/10 rounded w-2/3 mx-auto"></div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${className}`}>
      {/* Hidden audio element for playback */}
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        {...(allowWebCtx ? { crossOrigin: 'anonymous' as const } : {})}
      />
      
      <div className="glass-card p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
          {/* DJ Booth - Left */}
          <div className="order-2 lg:order-1">
            <DJBooth track={track} />
          </div>
          
          {/* Main Stage Area - Center */}
          <div className="order-1 lg:order-2">
            <div className="flex flex-col items-center gap-6">
              {/* Progress Ring */}
              <div className="relative">
                <ProgressRing progress={progressPercent} />
                
                {/* Vinyl record effect in center when playing */}
                {track?.status === 'PLAYING' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-24 h-24 border-4 border-white/30 rounded-full animate-spin bg-gradient-to-br from-gray-800 to-black"></div>
                  </div>
                )}
              </div>
              
              {/* Now Playing Info */}
              <div className="w-full">
                <NowPlayingMeta 
                  track={track} 
                  playheadSeconds={playheadSeconds}
                />
              </div>
            </div>
          </div>
          
          {/* Status Info - Right */}
          <div className="order-3">
            <div className="glass-card p-4 space-y-4">
              {/* Track Status */}
              <div className="text-center">
                <div className="text-white/70 text-sm mb-2">Status</div>
                <div className={`
                  px-3 py-1 rounded-full text-xs font-bold
                  ${track?.status === 'PLAYING' ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
                    track?.status === 'READY' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                    track?.status === 'GENERATING' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' :
                    'bg-gray-500/20 text-gray-300 border border-gray-500/30'}
                `}>
                  {track?.status || 'IDLE'}
                </div>
              </div>
              
              {/* Source Info */}
              {track && (
                <div className="text-center">
                  <div className="text-white/70 text-sm mb-2">Source</div>
                  <div className={`
                    px-3 py-1 rounded-full text-xs font-bold
                    ${track.source === 'GENERATED' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                      'bg-orange-500/20 text-orange-300 border border-orange-500/30'}
                  `}>
                    {track.source}
                  </div>
                </div>
              )}
              
              {/* Duration Badge */}
              {track && (
                <div className="text-center">
                  <div className="text-white/70 text-sm mb-2">Duration</div>
                  <div className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {track.duration_seconds}s
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}