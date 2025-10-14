// Reusable Avatar component
// Shows Discord avatar if available, otherwise shows letter avatar

import { useState, useEffect } from 'react'
import { resolveAvatar } from '../../lib/avatar'

interface AvatarProps {
  userId: string
  displayName: string
  size?: number // px, default 32
  className?: string
  hintedUrl?: string | null // Optional pre-fetched URL (e.g., from session for self)
}

export default function Avatar({ userId, displayName, size = 32, className = '', hintedUrl }: AvatarProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    setLoading(true)

    resolveAvatar(userId, hintedUrl)
      .then((url) => {
        if (mounted) {
          setAvatarUrl(url)
          setLoading(false)
        }
      })
      .catch((err) => {
        console.warn('Failed to resolve avatar:', err)
        if (mounted) {
          setAvatarUrl(null)
          setLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [userId, hintedUrl])

  // Letter avatar fallback
  const firstLetter = displayName.charAt(0).toUpperCase()
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-yellow-500',
    'bg-lime-500',
    'bg-green-500',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-cyan-500',
    'bg-sky-500',
    'bg-blue-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-purple-500',
    'bg-fuchsia-500',
    'bg-pink-500',
    'bg-rose-500'
  ]
  const colorIndex = displayName.charCodeAt(0) % colors.length
  const bgColor = colors[colorIndex]

  if (loading) {
    return (
      <div
        className={`rounded-full bg-gray-700 animate-pulse ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${displayName}'s avatar`}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
        onError={() => setAvatarUrl(null)} // Fallback to letter avatar on error
      />
    )
  }

  // Letter avatar
  return (
    <div
      className={`rounded-full ${bgColor} flex items-center justify-center text-white font-bold ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {firstLetter}
    </div>
  )
}
