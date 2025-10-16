import { useEffect, useRef, useState } from 'react'

/**
 * AutoplayUnlock
 * - Renders nothing once unlocked
 * - When locked, shows a full-screen click target that resumes audio on click
 * - Calls onUnlock() after audio is resumed so you can kick off play()
 * - Uses localStorage to persist unlock state per browser tab
 * - Does NOT depend on server state - dismisses on first user gesture
 *
 * Usage:
 *   <AutoplayUnlock onUnlock={() => audioRef.current?.play()?.catch(()=>{})} />
 */
export default function AutoplayUnlock({
  onUnlock,
  zIndex = 50
}: { onUnlock: () => void; zIndex?: number }) {
  const [locked, setLocked] = useState(true)
  const triedRef = useRef(false)
  const unlockedRef = useRef(false)

  useEffect(() => {
    // Check if already unlocked in this tab
    const wasUnlocked = localStorage.getItem('autoplayUnlocked') === 'true'
    if (wasUnlocked) {
      setLocked(false)
      unlockedRef.current = true
      return
    }

    // Show overlay until user gesture
    if (!triedRef.current) {
      triedRef.current = true
      setLocked(true)
    }
  }, [])

  const handleUnlock = async () => {
    // Prevent multiple unlocks
    if (unlockedRef.current) return
    unlockedRef.current = true

    // Persist unlock state
    try {
      localStorage.setItem('autoplayUnlocked', 'true')
      console.info('[AutoplayUnlock] unlocked via pointerdown')
    } catch (err) {
      console.warn('[AutoplayUnlock] localStorage unavailable:', err)
    }

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

    // Safety fallback after 1s - dismiss even if audio fails
    setTimeout(() => {
      const el = (window as any).__audioElement as HTMLAudioElement | null;
      if (!done && el && !el.paused) {
        finish();
      } else if (!done) {
        // Dismiss overlay even if audio didn't start
        console.info('[AutoplayUnlock] dismissed after timeout (server-independent)')
        finish();
      }
    }, 1000);
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Any key press counts as user gesture
    if (e.key) {
      handleUnlock()
    }
  }

  if (!locked) return null

  return (
    <button
      onClick={handleUnlock}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 w-full h-full flex items-center justify-center bg-black/70 text-white text-lg"
      style={{ zIndex }}
      aria-label="Click or press any key to enable audio"
    >
      Click or press any key to enable audio
    </button>
  )
}