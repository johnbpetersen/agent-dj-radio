import { useState, useEffect } from 'react'
import { getWhoami, unlinkDiscord, type WhoAmI } from '../api/auth'

export function AccountLinkingCard() {
  const [whoami, setWhoami] = useState<WhoAmI | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Fetch whoami on mount
  useEffect(() => {
    loadWhoami()
  }, [])

  async function loadWhoami() {
    try {
      setLoading(true)
      const data = await getWhoami()
      setWhoami(data)
    } catch (err) {
      console.error('Failed to load whoami:', err)
      setMessage({ type: 'error', text: `Failed to load account status: ${err}` })
    } finally {
      setLoading(false)
    }
  }

  async function handleUnlink() {
    try {
      setActionLoading(true)
      setMessage(null)
      const result = await unlinkDiscord()

      if (result.alreadyUnlinked) {
        setMessage({ type: 'success', text: 'Discord was already unlinked' })
      } else {
        setMessage({ type: 'success', text: 'Discord unlinked successfully' })
      }

      // Re-fetch whoami to update state
      await loadWhoami()
    } catch (err) {
      console.error('Failed to unlink Discord:', err)
      setMessage({ type: 'error', text: `Failed to unlink: ${err}` })
    } finally {
      setActionLoading(false)
    }
  }

  function handleLink() {
    // Navigate to Discord OAuth start
    window.location.href = '/api/auth/discord/start'
  }

  if (loading) {
    return (
      <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow">
        <p className="text-gray-600">Loading account status...</p>
      </div>
    )
  }

  if (!whoami) {
    return (
      <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow">
        <p className="text-red-600">Failed to load account status</p>
      </div>
    )
  }

  const isLinked = !whoami.ephemeral

  return (
    <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-4">Account Linking</h2>

      {/* Status */}
      <div className="mb-6">
        <p className="text-sm text-gray-600 mb-2">Discord Status:</p>
        <p className="text-lg font-semibold">
          {isLinked ? '✓ Linked to Discord' : '○ Not linked'}
        </p>
        {whoami.displayName && (
          <p className="text-sm text-gray-500 mt-1">Display name: {whoami.displayName}</p>
        )}
      </div>

      {/* Message */}
      {message && (
        <div className={`mb-4 p-3 rounded ${
          message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>
          {message.text}
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3">
        {isLinked ? (
          <button
            onClick={handleUnlink}
            disabled={actionLoading}
            className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading ? 'Unlinking...' : 'Unlink Discord'}
          </button>
        ) : (
          <button
            onClick={handleLink}
            disabled={actionLoading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Link Discord
          </button>
        )}
      </div>

      {/* Info */}
      <p className="mt-6 text-xs text-gray-500">
        Linking your Discord account marks your session as non-ephemeral and enables additional features.
      </p>
    </div>
  )
}
