// Hook for fetching and caching user avatars
// Now delegates to the centralized avatar utility

import { useState, useEffect } from 'react'
import { resolveAvatar } from '../lib/avatar'

export interface UseUserAvatarReturn {
  avatarUrl: string | null
  isLoading: boolean
  error: boolean
}

/**
 * Hook to fetch and cache user avatar
 * Handles null/missing user IDs gracefully
 * Uses centralized avatar utility with caching
 *
 * @param userId - User ID to fetch avatar for (null/undefined for guests)
 * @param hintedUrl - Optional pre-fetched avatar URL (e.g., from session for self)
 * @returns { avatarUrl, isLoading, error }
 */
export function useUserAvatar(
  userId: string | null | undefined,
  hintedUrl?: string | null
): UseUserAvatarReturn {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    // No user ID = guest user, return immediately
    if (!userId) {
      setAvatarUrl(null)
      setIsLoading(false)
      setError(false)
      return
    }

    // If hinted URL provided, use it immediately
    if (hintedUrl !== undefined) {
      setAvatarUrl(hintedUrl)
      setIsLoading(false)
      setError(false)
      return
    }

    // Fetch via centralized utility
    setIsLoading(true)
    setError(false)

    resolveAvatar(userId, hintedUrl)
      .then((url) => {
        setAvatarUrl(url)
        setError(false)
      })
      .catch(() => {
        setAvatarUrl(null)
        setError(true)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [userId, hintedUrl])

  return {
    avatarUrl,
    isLoading,
    error
  }
}
