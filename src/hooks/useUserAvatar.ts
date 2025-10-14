// Hook for fetching and caching user avatars

import { useState, useEffect } from 'react'

interface AvatarResponse {
  avatar_url: string | null
}

// Session-scoped in-memory cache to avoid refetch storms
// Key: user_id, Value: avatar_url | null
const avatarCache = new Map<string, string | null>()

// Track in-flight requests to prevent duplicate fetches
const inflightRequests = new Map<string, Promise<string | null>>()

/**
 * Fetch avatar URL for a user with caching
 * Returns null for guest users or fetch errors
 *
 * @param userId - User ID to fetch avatar for (null for guests)
 * @returns Avatar URL or null
 */
async function fetchAvatarUrl(userId: string): Promise<string | null> {
  // Check cache first
  if (avatarCache.has(userId)) {
    return avatarCache.get(userId) ?? null
  }

  // Check if request is already in-flight
  if (inflightRequests.has(userId)) {
    return inflightRequests.get(userId)!
  }

  // Start new request
  const fetchPromise = (async () => {
    try {
      const response = await fetch(`/api/users/${userId}/avatar`, {
        headers: {
          'Accept': 'application/json',
        }
      })

      if (!response.ok) {
        console.warn(`Avatar fetch failed for ${userId}: ${response.status}`)
        avatarCache.set(userId, null)
        return null
      }

      const data: AvatarResponse = await response.json()
      avatarCache.set(userId, data.avatar_url)
      return data.avatar_url
    } catch (error) {
      console.warn(`Avatar fetch error for ${userId}:`, error)
      avatarCache.set(userId, null)
      return null
    } finally {
      // Clean up in-flight tracking
      inflightRequests.delete(userId)
    }
  })()

  inflightRequests.set(userId, fetchPromise)
  return fetchPromise
}

export interface UseUserAvatarReturn {
  avatarUrl: string | null
  isLoading: boolean
  error: boolean
}

/**
 * Hook to fetch and cache user avatar
 * Handles null/missing user IDs gracefully
 * Uses session-scoped cache to prevent refetch spam
 *
 * @param userId - User ID to fetch avatar for (null/undefined for guests)
 * @returns { avatarUrl, isLoading, error }
 */
export function useUserAvatar(userId: string | null | undefined): UseUserAvatarReturn {
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

    // Check cache synchronously first
    if (avatarCache.has(userId)) {
      setAvatarUrl(avatarCache.get(userId) ?? null)
      setIsLoading(false)
      setError(false)
      return
    }

    // Need to fetch
    setIsLoading(true)
    setError(false)

    fetchAvatarUrl(userId)
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
  }, [userId])

  return {
    avatarUrl,
    isLoading,
    error
  }
}

/**
 * Clear avatar cache (useful for testing or after user profile updates)
 */
export function clearAvatarCache(): void {
  avatarCache.clear()
}
