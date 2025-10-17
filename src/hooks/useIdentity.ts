// src/hooks/useIdentity.ts
// Hook for fetching and managing user identity from durable sessions

import { useState, useEffect, useCallback } from 'react'
import { getWhoAmI, renameUser, type WhoAmIResponse } from '../lib/api'

interface UseIdentityReturn {
  identity: WhoAmIResponse | null
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>
  renaming: boolean
  rename: (displayName: string) => Promise<void>
}

export function useIdentity(): UseIdentityReturn {
  const [identity, setIdentity] = useState<WhoAmIResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [renaming, setRenaming] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getWhoAmI()
      setIdentity(data)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch identity'))
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount
  useEffect(() => {
    refresh()
  }, [refresh])

  const rename = useCallback(async (displayName: string) => {
    try {
      setRenaming(true)
      setError(null)
      await renameUser(displayName)
      // Refresh identity after successful rename
      await refresh()
    } catch (err) {
      // Re-throw so UI can handle specific error codes
      throw err
    } finally {
      setRenaming(false)
    }
  }, [refresh])

  return {
    identity,
    loading,
    error,
    refresh,
    renaming,
    rename
  }
}
