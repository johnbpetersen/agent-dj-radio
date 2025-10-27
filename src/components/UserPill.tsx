import { useState, useEffect } from 'react'
import { getWhoami, unlinkDiscord, type WhoAmI } from '../api/auth.js'
import { User, Loader2 } from 'lucide-react'

/**
 * UserPill: Compact nav component showing current user identity
 * with Discord link/unlink action based on ephemeral status.
 */
export function UserPill() {
  const [identity, setIdentity] = useState<WhoAmI | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchIdentity = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getWhoami()
      setIdentity(data)
    } catch (err) {
      setError('Failed to load identity')
      console.error('UserPill fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Initial fetch
  useEffect(() => {
    fetchIdentity()
  }, [])

  // Listen for refresh events (dispatched by App.tsx after Discord callback)
  useEffect(() => {
    const handleRefresh = () => {
      fetchIdentity()
    }
    window.addEventListener('user-identity-refresh', handleRefresh)
    return () => window.removeEventListener('user-identity-refresh', handleRefresh)
  }, [])

  const handleLinkDiscord = () => {
    // HTML flow - navigate to OAuth start
    window.location.href = '/api/auth/discord/start'
  }

  const handleUnlinkDiscord = async () => {
    if (!window.confirm('Unlink your Discord account? You will become an ephemeral user.')) {
      return
    }

    try {
      setActionLoading(true)
      setError(null)
      await unlinkDiscord()

      // Refresh identity to get updated displayName (reverts to ephemeral name)
      await fetchIdentity()
    } catch (err) {
      setError('Failed to unlink Discord')
      console.error('Unlink error:', err)
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/20">
        <Loader2 className="w-4 h-4 text-white/60 animate-spin" />
        <span className="text-sm text-white/60">Loading...</span>
      </div>
    )
  }

  if (error || !identity) {
    return (
      <div className="flex items-center gap-2 bg-red-500/20 backdrop-blur-sm px-3 py-2 rounded-lg border border-red-500/30">
        <span className="text-xs text-red-300">{error || 'Error'}</span>
      </div>
    )
  }

  // Truncate displayName to max 16 chars
  const displayName = identity.displayName || 'Guest'
  const truncatedName = displayName.length > 16
    ? displayName.substring(0, 16) + '...'
    : displayName

  return (
    <div className="flex items-center gap-3 bg-black/40 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/20 shadow-lg">
      <div className="flex items-center gap-2">
        <User className="w-4 h-4 text-white/70" />
        <span className="text-sm font-medium text-white" title={displayName}>
          {truncatedName}
        </span>
      </div>

      {identity.ephemeral ? (
        <button
          onClick={handleLinkDiscord}
          disabled={actionLoading}
          className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold px-3 py-1.5 rounded border border-indigo-400/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Link Discord
        </button>
      ) : (
        <button
          onClick={handleUnlinkDiscord}
          disabled={actionLoading}
          className="bg-red-500/80 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded border border-red-400/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {actionLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          Unlink Discord
        </button>
      )}
    </div>
  )
}
