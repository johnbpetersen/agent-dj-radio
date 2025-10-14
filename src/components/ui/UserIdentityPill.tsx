// UserIdentityPill - Shows user identity with Discord badge and unlink option

import { useState } from 'react'
import { useEphemeralUser } from '../../hooks/useEphemeralUser'
import Avatar from './Avatar'

export default function UserIdentityPill() {
  const { identity, unlinkDiscord } = useEphemeralUser()
  const [showMenu, setShowMenu] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)

  if (!identity) {
    return null
  }

  const handleUnlink = async () => {
    setIsUnlinking(true)
    try {
      const success = await unlinkDiscord()
      if (success) {
        setShowConfirm(false)
        setShowMenu(false)
        // Show toast notification
        alert('Discord disconnected — sign in again to chat')
      }
    } finally {
      setIsUnlinking(false)
    }
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-2 bg-black/40 backdrop-blur-sm border border-white/20 rounded-full px-3 py-1.5 shadow-lg hover:bg-black/50 transition-colors"
        >
          {/* Discord badge (only when linked) */}
          {identity.isDiscordLinked && identity.discord?.avatarUrl && (
            <img
              src={identity.discord.avatarUrl}
              alt="Discord avatar"
              className="w-6 h-6 rounded-full"
            />
          )}

          {/* Display label */}
          <span className="text-sm text-white/90 font-medium">
            {identity.displayLabel}
          </span>

          {/* Discord badge indicator */}
          {identity.isDiscordLinked && (
            <svg className="w-4 h-4 text-[#5865F2]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
          )}
        </button>

        {/* Dropdown menu */}
        {showMenu && (
          <div className="absolute right-0 mt-2 w-48 bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg shadow-xl z-50">
            <div className="p-2">
              {identity.isDiscordLinked ? (
                <button
                  onClick={() => setShowConfirm(true)}
                  className="w-full text-left px-3 py-2 text-sm text-white/90 hover:bg-white/10 rounded transition-colors"
                >
                  Disconnect Discord
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowMenu(false)
                    window.location.href = '/api/auth/discord/start'
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-white/90 hover:bg-white/10 rounded transition-colors"
                >
                  Connect Discord
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-white/20 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-white mb-2">Disconnect Discord?</h3>
            <p className="text-white/70 mb-4">
              You'll revert to your ephemeral identity ({identity.ephemeralName}). You can reconnect anytime.
            </p>
            <p className="text-yellow-500/90 text-sm mb-6">
              Note: Chat will be disabled until you sign in with Discord again.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={isUnlinking}
                className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUnlink}
                disabled={isUnlinking}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50"
              >
                {isUnlinking ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
