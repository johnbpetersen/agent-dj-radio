import { useState, useMemo, useRef, useEffect } from 'react';
import { useStation } from '../../../hooks/useStation';
import { useEphemeralUser } from '../../../hooks/useEphemeralUser';
import AutoplayUnlock from '../../AutoplayUnlock';
import SubmitForm from '../../SubmitForm';
import RoomScene from './RoomScene';

export default function Layout() {
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const { currentTrack, playheadSeconds, queue, isLoading, error, refetch, advanceStation } = useStation();
  useEphemeralUser();

  const audioRef = useRef<HTMLAudioElement>(null);
  const allowWebCtx = import.meta.env.VITE_ENABLE_WEBCTX === 'true';

  // --- AUDIO ENGINE LOGIC ---

  // Creates the __adrUnlockAudio function that AutoplayUnlock calls
  useEffect(() => {
    (window as any).__adrUnlockAudio = async () => {
      const a = audioRef.current; if (!a) return false;
      try {
        a.muted = false; a.volume = 1; await a.play().catch(() => {});
        if (allowWebCtx) {
          const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (Ctx) {
            let ctx = (window as any).__adrAudioCtx as AudioContext | undefined;
            if (!ctx) { ctx = new Ctx(); (window as any).__adrAudioCtx = ctx; }
            if (ctx && ctx.state !== 'running') await ctx.resume().catch(() => {});
            let srcNode = (window as any).__adrSrcNode as MediaElementAudioSourceNode | undefined;
            if (ctx && !srcNode) {
              srcNode = (window as any).__adrSrcNode = ctx.createMediaElementSource(a);
              srcNode.connect(ctx.destination);
            }
          }
        }
        (window as any).__adrUnlocked = true;
        return !a.paused;
      } catch (err) { return false; }
    };
    return () => { delete (window as any).__adrUnlockAudio; };
  }, [allowWebCtx]);

  // Sets the audio source when the track changes
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const url = currentTrack?.audio_url || '';
    if (!url) return;
    a.pause();
    const wasUnlocked = (window as any).__adrUnlocked === true;
    if (allowWebCtx) { a.crossOrigin = 'anonymous'; }
    a.src = url; a.load(); a.currentTime = 0;
    if (wasUnlocked) { a.play().catch(() => {}); }
  }, [currentTrack?.id, currentTrack?.audio_url, allowWebCtx]);

  // Syncs the playhead
  useEffect(() => {
    const audio = audioRef.current; if (!audio || !currentTrack) return;
    const drift = Math.abs(playheadSeconds - audio.currentTime);
    if (drift > 2 && !audio.seeking) { audio.currentTime = playheadSeconds; }
  }, [playheadSeconds, currentTrack]);

  // Advances the station when a track ends
  useEffect(() => {
    const audio = audioRef.current; if (!audio) return;
    const handleEnded = () => { advanceStation(); };
    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [advanceStation]);

  // --- FIX IS HERE: Broadcasts the 'adr:audio-playing' event ---
  // This is the missing piece. It tells AutoplayUnlock that audio has successfully started.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    
    const onPlaying = () => {
      try {
        window.dispatchEvent(new CustomEvent('adr:audio-playing'));
      } catch {}
    };
    
    a.addEventListener('playing', onPlaying);
    return () => a.removeEventListener('playing', onPlaying);
  }, [currentTrack?.id]); // Re-attach listener when track changes


  const handleSubmitSuccess = () => {
    setShowSubmitForm(false);
    refetch();
  };

  const roomData = useMemo(() => {
    const nowPlaying = currentTrack ? {
      title: currentTrack.prompt,
      artist: currentTrack.user?.display_name || 'Unknown',
      elapsedSec: playheadSeconds,
      durationSec: currentTrack.duration_seconds,
    } : null;
    const djMap = new Map();
    if (currentTrack?.user) { djMap.set(currentTrack.user.id, { id: currentTrack.user.id, name: currentTrack.user.display_name, isCurrent: true }); }
    queue.forEach(track => {
      if (track.user && !djMap.has(track.user.id)) { djMap.set(track.user.id, { id: track.user.id, name: track.user.display_name, isCurrent: false }); }
    });
    const djs = Array.from(djMap.values());
    const listeners = djs;
    return { nowPlaying, djs, listeners };
  }, [currentTrack, playheadSeconds, queue]);
  
  if (isLoading && !currentTrack) { /* Loading... */ }
  if (error) { /* Error... */ }

  return (
    <>
      <audio ref={audioRef} preload="auto" playsInline {...(allowWebCtx ? { crossOrigin: 'anonymous' as const } : {})} />
      <RoomScene
        nowPlaying={roomData.nowPlaying}
        djs={roomData.djs}
        listeners={roomData.listeners}
        onQueueTrack={() => setShowSubmitForm(true)}
      />
      <AutoplayUnlock onUnlock={() => (window as any).__adrUnlockAudio?.()} />
      {showSubmitForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900/80 border border-white/10 p-6 max-w-md w-full rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Queue a Track</h2>
              <button onClick={() => setShowSubmitForm(false)} className="text-white/60 hover:text-white p-1">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <SubmitForm onSubmitSuccess={handleSubmitSuccess} />
          </div>
        </div>
      )}
    </>
  );
}