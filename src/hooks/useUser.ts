import { useState, useEffect, useCallback } from 'react'
import type { User } from '../types'

interface StoredUser {
  id: string
  display_name: string
}

interface UseUserReturn {
  user: User | null
  isLoading: boolean
  error: string | null
  setDisplayName: (name: string) => Promise<boolean>
  clearUser: () => void
}

const USER_STORAGE_KEY = 'adr:user'

export function useUser(): UseUserReturn {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load user from localStorage on mount
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem(USER_STORAGE_KEY)
      if (storedUser) {
        const parsed: StoredUser = JSON.parse(storedUser)
        // Convert stored user to full User object
        const fullUser: User = {
          id: parsed.id,
          display_name: parsed.display_name,
          banned: false, // We'll fetch this from server if needed
          created_at: new Date().toISOString() // Placeholder
        }
        setUser(fullUser)
      }
    } catch (err) {
      console.warn('Failed to load user from localStorage:', err)
      localStorage.removeItem(USER_STORAGE_KEY)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const setDisplayName = useCallback(async (displayName: string): Promise<boolean> => {
    if (!displayName.trim()) {
      setError('Display name is required')
      return false
    }

    if (displayName.trim().length > 50) {
      setError('Display name too long (max 50 characters)')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      // Call API to create or get user
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName.trim() })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create user')
      }

      const userData = await response.json()
      const newUser: User = userData.user

      // Store user in localStorage
      const storedUser: StoredUser = {
        id: newUser.id,
        display_name: newUser.display_name
      }
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(storedUser))

      setUser(newUser)
      return true
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create user'
      setError(errorMessage)
      console.error('Failed to set display name:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  const clearUser = useCallback(() => {
    localStorage.removeItem(USER_STORAGE_KEY)
    setUser(null)
    setError(null)
  }, [])

  return {
    user,
    isLoading,
    error,
    setDisplayName,
    clearUser
  }
}