import { useRef, useEffect, useCallback } from 'react'
import type { Track } from '../../../types'
import Avatar from './Avatar'
import NowPlayingMeta from './NowPlayingMeta'
import ReactionBar from './ReactionBar'

interface StageProps {
  track: Track | null
  playheadSeconds: number
  isLoading: boolean
  className?: string
  onAdvance?: () => void
  userId: string | null
  onReactionSuccess: () => void
}

function DJBooth({ track }: { track: Track | null }) {
  if (!track || !track.user) {
    return (
      <div className="flex flex-col items-center gap-2 opacity-50">
        <Avatar name="?" size="lg" />
        <div className="text-white/60 text-sm">Waiting for DJ...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar
        name={track.user.display_name}
        size="xl"
        isDJ={true}
        isOnline={track.status === 'PLAYING'}
      />
      <div className="text-white font-bold text-lg">{track.user.display_name}</div>
    </div>
  )
}


export default function Stage({
  track,
  playheadSeconds,
  isLoading,
  className = '',
  onAdvance,
  userId,
  onReactionSuccess
}: StageProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const setAudioRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    (window as any).__audioElement = node || undefined;
    if (import.meta.env.DEV && node) {
      (window as any).__audioState = () => {
        const ctx = (window as any).__adrAudioCtx;
        if (!node) return { error: 'no audio element' };
        return {
          src: node.currentSrc, paused: node.paused, muted: node.muted, volume: node.volume, currentTime: node.currentTime,
          readyState: node.readyState, allowWebCtx, hasContext: !!ctx, ctxState: ctx?.state,
          hasSrcNode: !!((window as any).__adrSrcNode), unlocked: !!((window as any).__adrUnlocked)
        };
      };
    }
  }, []);
  const allowWebCtx = import.meta.env.VITE_ENABLE_WEBCTX === 'true';
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const onPlaying = () => { try { window.dispatchEvent(new CustomEvent('adr:audio-playing')); } catch {} };
    a.addEventListener('playing', onPlaying);
    return () => a.removeEventListener('playing', onPlaying);
  }, [track?.id]);
  useEffect(() => {
    (window as any).__adrUnlockAudio = async () => {
      const a = audioRef.current; if (!a) return false;
      try {
        a.muted = false; a.volume = 1; await a.play().catch(() => {});
        if (allowWebCtx) {
          const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (Ctx) {
            let ctx = (window as any).__adrAudioCtx as AudioContext | undefined;
            if (!ctx) {
              try {
                ctx = new Ctx();
                (window as any).__adrAudioCtx = ctx;
              } catch (e) {
                console.error("Failed to create AudioContext", e);
              }
            }
            
            // --- FIX IS HERE ---
            // This 'if (ctx)' block ensures we don't try to use a null/undefined AudioContext.
            if (ctx) {
              if (ctx.state !== 'running') await ctx.resume().catch(() => {});
              let srcNode = (window as any).__adrSrcNode as MediaElementAudioSourceNode | undefined;
              if (!srcNode) {
                srcNode = (window as any).__adrSrcNode = ctx.createMediaElementSource(a);
                srcNode.connect(ctx.destination);
              }
            }
          }
        }
        (window as any).__adrUnlocked = true;
        return !a.paused;
      } catch (err) { return false; }
    };
    return () => { delete (window as any).__adrUnlockAudio; };
  }, [allowWebCtx]);
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const url = (track?.audio_url && track.audio_url.trim()) || ((track as any)?.audioUrl && (track as any).audioUrl.trim()) || '';
    if (!url) return;
    a.pause();
    const wasUnlocked = (window as any).__adrUnlocked === true;
    if (allowWebCtx) { a.crossOrigin = 'anonymous'; }
    a.src = url; a.load(); a.currentTime = 0;
    if (wasUnlocked) { a.play().catch(() => {}); }
  }, [track?.id, track?.audio_url, allowWebCtx]);
  useEffect(() => {
    const audio = audioRef.current; if (!audio || !track) return;
    const targetTime = playheadSeconds;
    const drift = Math.abs(targetTime - audio.currentTime);
    if (drift > 2 && !audio.seeking) { audio.currentTime = targetTime; }
  }, [playheadSeconds, track]);
  useEffect(() => {
    const audio = audioRef.current; if (!audio || !onAdvance) return;
    const handleEnded = () => { onAdvance(); };
    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [onAdvance]);

  if (isLoading) {
    return (
      <div className={`w-full max-w-4xl h-64 bg-black/30 rounded-t-lg animate-pulse ${className}`} />
    )
  }

  return (
    <div className={`relative w-full max-w-4xl ${className}`}>
      <audio ref={setAudioRef} preload="auto" playsInline {...(allowWebCtx ? { crossOrigin: 'anonymous' as const } : {})} />

      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-end justify-center gap-8">
        <DJBooth track={track} />
      </div>

      <div className="bg-gradient-to-b from-gray-700 to-gray-800 border-2 border-gray-900 rounded-t-lg shadow-2xl pt-24 pb-4 px-4">
        <div className="mb-4">
          <NowPlayingMeta track={track} playheadSeconds={playheadSeconds} />
        </div>

        <ReactionBar
          track={track}
          userId={userId}
          onReactionSuccess={onReactionSuccess}
        />
      </div>
    </div>
  )
}