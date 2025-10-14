// Avatar resolution utility with caching
// Unifies avatar fetching across the app and prevents 404 spam

interface AvatarCacheEntry {
  url: string | null
  timestamp: number
}

// In-memory cache: Map<userId, AvatarCacheEntry>
const avatarCache = new Map<string, AvatarCacheEntry>()

// Cache TTL matches API Cache-Control (5 minutes)
const AVATAR_CACHE_TTL_MS = parseInt(process.env.AVATAR_CACHE_MAX_AGE_SEC || '300', 10) * 1000

// Track in-flight requests to prevent duplicate fetches
const inflightRequests = new Map<string, Promise<string | null>>()

/**
 * Resolve avatar URL for a user
 * - If hintedUrl provided (from session for self), use that and cache it
 * - Else fetch from API with caching
 * - Always returns 200 with null for unknown/guest users (no 404s)
 *
 * @param userId - User ID to fetch avatar for
 * @param hintedUrl - Optional pre-fetched avatar URL (e.g., from session for self)
 * @returns Avatar URL or null
 */
export async function resolveAvatar(
  userId: string | null | undefined,
  hintedUrl?: string | null
): Promise<string | null> {
  // No user ID = guest
  if (!userId) {
    return null
  }

  // If hinted URL provided, cache it and return
  if (hintedUrl !== undefined) {
    avatarCache.set(userId, {
      url: hintedUrl,
      timestamp: Date.now()
    })
    return hintedUrl
  }

  // Check cache
  const cached = avatarCache.get(userId)
  if (cached && Date.now() - cached.timestamp < AVATAR_CACHE_TTL_MS) {
    return cached.url
  }

  // Check if request is already in-flight
  if (inflightRequests.has(userId)) {
    return inflightRequests.get(userId)!
  }

  // Start new fetch
  const fetchPromise = (async () => {
    try {
      const response = await fetch(`/api/users/${userId}/avatar`, {
        headers: {
          'Accept': 'application/json',
        },
        credentials: 'same-origin'
      })

      // API always returns 200 with { avatar_url: string | null }
      if (!response.ok) {
        console.warn(`Avatar fetch unexpected status for ${userId}: ${response.status}`)
        avatarCache.set(userId, { url: null, timestamp: Date.now() })
        return null
      }

      const data: { avatar_url: string | null } = await response.json()
      const avatarUrl = data.avatar_url

      // Cache result
      avatarCache.set(userId, {
        url: avatarUrl,
        timestamp: Date.now()
      })

      return avatarUrl
    } catch (error) {
      console.warn(`Avatar fetch error for ${userId}:`, error)
      avatarCache.set(userId, { url: null, timestamp: Date.now() })
      return null
    } finally {
      // Clean up in-flight tracking
      inflightRequests.delete(userId)
    }
  })()

  inflightRequests.set(userId, fetchPromise)
  return fetchPromise
}

/**
 * Clear avatar cache (useful after unlink or profile updates)
 * @param userId - Optional user ID to clear specific entry, or clear all if not provided
 */
export function clearAvatarCache(userId?: string): void {
  if (userId) {
    avatarCache.delete(userId)
  } else {
    avatarCache.clear()
  }
}

/**
 * Preload avatar into cache (useful when we already have the URL from session)
 * @param userId - User ID
 * @param avatarUrl - Avatar URL to cache
 */
export function preloadAvatar(userId: string, avatarUrl: string | null): void {
  avatarCache.set(userId, {
    url: avatarUrl,
    timestamp: Date.now()
  })
}
