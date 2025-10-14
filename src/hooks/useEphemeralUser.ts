// useEphemeralUser hook for ephemeral user management
// Handles session-based authentication with auto-generated names and presence

import { useState, useEffect, useCallback, useRef } from 'react'
import { generateFunName } from '../lib/name-generator'
import { apiFetch } from '../lib/api'

interface EphemeralUser {
  id: string
  display_name: string
  bio: string | null
  is_agent: boolean
  isDiscordLinked?: boolean
  isWalletLinked?: boolean
}

interface UseEphemeralUserReturn {
  user: EphemeralUser | null
  sessionId: string | null
  loading: boolean
  error: string | null
  rename: (newName: string) => Promise<boolean>
  setBio: (bio: string) => Promise<boolean>
  linkDiscord: () => void
  reset: () => void
}

const STORAGE_KEY = 'adr:ephemeral_user'
const SESSION_STORAGE_KEY = 'adr:session_id'

// Generate UUID v4
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

export function useEphemeralUser(): UseEphemeralUserReturn {
  const [user, setUser] = useState<EphemeralUser | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Track if ephemeral users are enabled
  const [featureEnabled, setFeatureEnabled] = useState(false)
  
  // Presence ping interval with adaptive backoff
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [pingInterval, setPingInterval] = useState(30000) // Start at 30s
  const pingIntervalValueRef = useRef(30000) // Keep track of current interval
  
  // Check feature flag and initialize session
  useEffect(() => {
    const initializeSession = async () => {
      try {
        // Assume ephemeral users are enabled, let actual usage determine availability
        setFeatureEnabled(true)

        // Get or generate session ID
        let currentSessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)
        if (!currentSessionId) {
          currentSessionId = generateUUID()
          sessionStorage.setItem(SESSION_STORAGE_KEY, currentSessionId)
        }
        setSessionId(currentSessionId)

        // Try to restore user from session storage
        const storedUser = sessionStorage.getItem(STORAGE_KEY)
        if (storedUser) {
          try {
            const parsed = JSON.parse(storedUser) as EphemeralUser
            setUser(parsed)
          } catch (err) {
            console.warn('Failed to parse stored user, will create new session')
            sessionStorage.removeItem(STORAGE_KEY)
          }
        }

        // Check if we just linked Discord and need to refresh session
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search)
          if (params.get('discord_linked') === '1') {
            try {
              // Re-fetch session to pick up isDiscordLinked: true
              await initializeWithServer(currentSessionId)
            } finally {
              // Clean the URL
              params.delete('discord_linked')
              const newUrl = window.location.pathname + (params.toString() ? `?${params}` : '')
              window.history.replaceState({}, '', newUrl)
            }
            return // Skip normal initialization since we already refreshed
          }
        }

        // Initialize session with server
        await initializeWithServer(currentSessionId)

      } catch (err) {
        console.error('Failed to initialize ephemeral user session:', err)
        setError('Failed to initialize session')
      } finally {
        setLoading(false)
      }
    }

    initializeSession()

    // Cleanup on unmount
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
      }
    }
  }, [])
  
  const initializeWithServer = async (currentSessionId: string) => {
    try {
      // Generate a fun name for new users
      const funName = generateFunName()

      const response = await apiFetch('/api/session/hello', {
        method: 'POST',
        body: JSON.stringify({
          display_name: funName
        })
      })
      
      if (!response.ok) {
        if (response.status === 409) {
          // Name conflict - try again with a different name
          const errorData = await response.json()
          if (errorData.suggestions && errorData.suggestions.length > 0) {
            // Retry with first suggestion
            const retryResponse = await apiFetch('/api/session/hello', {
              method: 'POST',
              body: JSON.stringify({
                display_name: errorData.suggestions[0]
              })
            })
            
            if (retryResponse.ok) {
              const retryData = await retryResponse.json()
              const userData = {
                ...retryData.user,
                isDiscordLinked: retryData.user.isDiscordLinked ?? false,
                isWalletLinked: retryData.user.isWalletLinked ?? false
              }
              setUser(userData)
              sessionStorage.setItem(STORAGE_KEY, JSON.stringify(userData))
              startPresencePing(currentSessionId)
              return
            }
          }
        }
        throw new Error(`Server error: ${response.status}`)
      }
      
      const data = await response.json()

      // Map response structure: { user: {...}, session_id: "..." }
      // The user object from API includes isDiscordLinked and isWalletLinked
      const userData = {
        ...data.user,
        isDiscordLinked: data.user.isDiscordLinked ?? false,
        isWalletLinked: data.user.isWalletLinked ?? false
      }

      setUser(userData)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(userData))

      // Start presence ping
      startPresencePing(currentSessionId)
      
    } catch (err) {
      console.error('Failed to initialize with server:', err)
      setError('Failed to connect to server')
    }
  }
  
  const sendPresencePing = async (currentSessionId: string) => {
    try {
      const response = await apiFetch('/api/presence/ping', {
        method: 'POST',
        body: JSON.stringify({})
      })

      if (response.status === 429) {
        // Rate limited - back off: double interval (max 120s)
        const newInterval = Math.min(pingIntervalValueRef.current * 2, 120000)
        pingIntervalValueRef.current = newInterval
        setPingInterval(newInterval)
        console.warn(`Presence ping rate limited, backing off to ${newInterval / 1000}s`)
      } else if (response.ok) {
        // Success - slowly reduce interval back to baseline (30s)
        const newInterval = Math.max(pingIntervalValueRef.current * 0.9, 30000)
        if (newInterval !== pingIntervalValueRef.current) {
          pingIntervalValueRef.current = newInterval
          setPingInterval(newInterval)
        }
      }
    } catch (err) {
      console.warn('Presence ping failed:', err)
      // Continue trying - don't stop the interval
    }
  }

  const startPresencePing = (currentSessionId: string) => {
    // Clear any existing interval
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
    }

    // Function to schedule next ping
    const schedulePing = () => {
      pingIntervalRef.current = setTimeout(async () => {
        await sendPresencePing(currentSessionId)
        // Schedule next ping with potentially updated interval
        schedulePing()
      }, pingIntervalValueRef.current)
    }

    // Start pinging
    schedulePing()
  }
  
  const rename = useCallback(async (newName: string): Promise<boolean> => {
    if (!sessionId || !featureEnabled) {
      setError('Session not initialized')
      return false
    }
    
    if (!newName.trim()) {
      setError('Display name is required')
      return false
    }
    
    try {
      setError(null)

      const response = await apiFetch('/api/users/rename', {
        method: 'POST',
        body: JSON.stringify({
          new_name: newName.trim()
        })
      })
      
      if (!response.ok) {
        if (response.status === 409) {
          const errorData = await response.json()
          setError(`Name "${newName.trim()}" is already taken. Try: ${errorData.suggestions?.join(', ')}`)
          return false
        } else if (response.status === 429) {
          const errorData = await response.json()
          setError('Too many rename attempts. Please try again later.')
          return false
        } else {
          const errorData = await response.json()
          setError(errorData.error || 'Failed to rename')
          return false
        }
      }

      const data = await response.json()
      const userData = {
        ...data.user,
        isDiscordLinked: data.user.isDiscordLinked ?? false,
        isWalletLinked: data.user.isWalletLinked ?? false
      }
      setUser(userData)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(userData))

      return true
    } catch (err) {
      console.error('Rename failed:', err)
      setError('Network error during rename')
      return false
    }
  }, [sessionId, featureEnabled])
  
  const setBio = useCallback(async (bio: string): Promise<boolean> => {
    if (!sessionId || !featureEnabled) {
      setError('Session not initialized')
      return false
    }
    
    try {
      setError(null)

      const response = await apiFetch('/api/users/bio', {
        method: 'POST',
        body: JSON.stringify({
          bio: bio.trim() || null
        })
      })
      
      if (!response.ok) {
        if (response.status === 429) {
          setError('Too many bio updates. Please try again later.')
          return false
        } else {
          const errorData = await response.json()
          setError(errorData.error || 'Failed to update bio')
          return false
        }
      }

      const data = await response.json()
      const userData = {
        ...data.user,
        isDiscordLinked: data.user.isDiscordLinked ?? false,
        isWalletLinked: data.user.isWalletLinked ?? false
      }
      setUser(userData)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(userData))

      return true
    } catch (err) {
      console.error('Bio update failed:', err)
      setError('Network error during bio update')
      return false
    }
  }, [sessionId, featureEnabled])
  
  const linkDiscord = useCallback(() => {
    // Redirect to Discord OAuth start endpoint
    window.location.href = '/api/auth/discord/start'
  }, [])

  const reset = useCallback(() => {
    // Development helper to reset session
    if (process.env.NODE_ENV === 'development') {
      sessionStorage.removeItem(STORAGE_KEY)
      sessionStorage.removeItem(SESSION_STORAGE_KEY)

      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
      }

      // Reload page to restart session
      window.location.reload()
    }
  }, [])

  // If feature is not enabled, return null user but not loading
  if (!featureEnabled && !loading) {
    return {
      user: null,
      sessionId: null,
      loading: false,
      error: null,
      rename: async () => false,
      setBio: async () => false,
      linkDiscord,
      reset
    }
  }

  return {
    user,
    sessionId,
    loading,
    error,
    rename,
    setBio,
    linkDiscord,
    reset
  }
}