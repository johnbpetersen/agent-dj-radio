// Avatar resolution utility with caching
// Unifies avatar fetching across the app and prevents 404 spam
// Pure browser module - no Node.js globals

interface AvatarCacheEntry {
  url: string | null
  expiresAt: number
  inflight?: Promise<string | null>
}

// In-memory cache: Map<userId, AvatarCacheEntry>
const avatarCache = new Map<string, AvatarCacheEntry>()

// Track users we've already logged errors for (to avoid spam)
const loggedErrors = new Set<string>()

// Cache TTL matches API Cache-Control (5 minutes)
// Use VITE_ prefix for client-side env vars
const MAX_AGE_SEC = Number(import.meta.env.VITE_AVATAR_CACHE_MAX_AGE_SEC ?? 300) || 300
const AVATAR_CACHE_TTL_MS = MAX_AGE_SEC * 1000

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
    return hintedUrl ?? null
  }

  // If hinted URL provided, cache it and return immediately
  if (hintedUrl !== undefined && hintedUrl !== null) {
    const now = Date.now()
    avatarCache.set(userId, {
      url: hintedUrl,
      expiresAt: now + AVATAR_CACHE_TTL_MS
    })
    return hintedUrl
  }

  const now = Date.now()

  // Check cache
  const cached = avatarCache.get(userId)
  if (cached) {
    // If not expired, return cached value
    if (cached.expiresAt > now) {
      return cached.url
    }

    // If inflight request exists, await it
    if (cached.inflight) {
      return cached.inflight
    }
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
        // Log once per userId to avoid spam
        if (!loggedErrors.has(userId)) {
          console.warn(`Avatar fetch unexpected status for ${userId}: ${response.status}`)
          loggedErrors.add(userId)
        }
        const entry: AvatarCacheEntry = { url: null, expiresAt: now + AVATAR_CACHE_TTL_MS }
        avatarCache.set(userId, entry)
        return null
      }

      const data: { avatar_url: string | null } = await response.json().catch(() => ({ avatar_url: null }))
      const avatarUrl = typeof data?.avatar_url === 'string' ? data.avatar_url : null

      // Cache result
      const entry: AvatarCacheEntry = {
        url: avatarUrl,
        expiresAt: now + AVATAR_CACHE_TTL_MS
      }
      avatarCache.set(userId, entry)

      return avatarUrl
    } catch (error) {
      // Log once per userId to avoid spam
      if (!loggedErrors.has(userId)) {
        console.warn(`Avatar fetch error for ${userId}:`, error)
        loggedErrors.add(userId)
      }
      const entry: AvatarCacheEntry = { url: null, expiresAt: now + AVATAR_CACHE_TTL_MS }
      avatarCache.set(userId, entry)
      return null
    }
  })()

  // Store inflight promise in cache
  avatarCache.set(userId, {
    url: cached?.url ?? null,
    expiresAt: now + AVATAR_CACHE_TTL_MS,
    inflight: fetchPromise
  })

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
  const now = Date.now()
  avatarCache.set(userId, {
    url: avatarUrl,
    expiresAt: now + AVATAR_CACHE_TTL_MS
  })
}
