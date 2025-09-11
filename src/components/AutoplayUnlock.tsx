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
    // Detect if we need an unlock
    // Try to resume an AudioContext silently; if it's already running, we're good
    const tryDetect = async () => {
      if (triedRef.current) return
      triedRef.current = true

      try {
        const Ctx = (window.AudioContext || (window as any).webkitAudioContext)
        if (!Ctx) {
          // No Web Audio — we'll still rely on user gesture for <audio>.play()
          setLocked(true)
          return
        }
        const ctx = new Ctx()
        if (ctx.state === 'suspended') {
          // Needs user gesture
          setLocked(true)
        } else {
          // Already running (returning visitor, prior gesture, etc.)
          onUnlock()
        }
      } catch {
        setLocked(true)
      }
    }
    // give the page a tick to mount things before probing
    const id = window.setTimeout(tryDetect, 0)
    return () => clearTimeout(id)
  }, [onUnlock])

  const handleUnlock = async () => {
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext)
      if (Ctx) {
        const ctx = new Ctx()
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {})
        }
      }
      onUnlock()
    } finally {
      setLocked(false)
    }
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