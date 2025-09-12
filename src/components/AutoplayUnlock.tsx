import { useEffect, useRef, useState } from 'react'

/**
 * AutoplayUnlock
 * - Renders nothing once unlocked
 * - When locked, shows a full-screen click target that resumes audio on click
 * - Calls onUnlock() after audio is resumed so you can kick off play()
 *
 * Usage:
 *   <AutoplayUnlock onUnlock={() => audioRef.current?.play()?.catch(()=>{})} />
 */
export default function AutoplayUnlock({
  onUnlock,
  zIndex = 50
}: { onUnlock: () => void; zIndex?: number }) {
  const [locked, setLocked] = useState(false)
  const triedRef = useRef(false)

  useEffect(() => {
    // No AudioContext work on mount. Gesture-only in Stage's unlock handler.
    // Always show unlock overlay until user clicks
    if (!triedRef.current) {
      triedRef.current = true
      setLocked(true)
    }
  }, [onUnlock])

  const handleUnlock = async () => {
    // Hide immediately if already playing
    const a = (window as any).__audioElement as HTMLAudioElement | null;
    if (a && !a.paused) {
      setLocked(false);
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setLocked(false);
      window.removeEventListener('adr:audio-playing', finish, { capture: false } as any);
    };

    // Listen for Stage to announce real playback
    window.addEventListener('adr:audio-playing', finish, { once: true });

    // Trigger unlocks
    try { await (window as any).__adrUnlockAudio?.(); } catch {}
    try { onUnlock?.(); } catch {}

    // Safety fallback after 1s
    setTimeout(() => {
      const el = (window as any).__audioElement as HTMLAudioElement | null;
      if (!done && el && !el.paused) finish();
    }, 1000);
  }

  if (!locked) return null

  return (
    <button
      onClick={handleUnlock}
      className="fixed inset-0 w-full h-full flex items-center justify-center bg-black/70 text-white text-lg"
      style={{ zIndex }}
      aria-label="Click to enable audio"
    >
      Click to enable audio
    </button>
  )
}