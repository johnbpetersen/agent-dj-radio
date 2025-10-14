// UserIdentityPill - Shows "Signed in as @username" after Discord link

import { useEffect, useState } from 'react'
import { useEphemeralUser } from '../../hooks/useEphemeralUser'
import Avatar from './Avatar'

export default function UserIdentityPill() {
  const { user } = useEphemeralUser()
  const [discordUsername, setDiscordUsername] = useState<string | null>(null)

  useEffect(() => {
    // Fetch Discord username from user metadata if available
    if (user?.isDiscordLinked && user?.id) {
      fetchDiscordUsername(user.id)
    }
  }, [user?.isDiscordLinked, user?.id])

  const fetchDiscordUsername = async (userId: string) => {
    try {
      // Try to get username from user_accounts table via session/hello
      // The username is stored in meta.username field
      const response = await fetch('/api/session/hello', { method: 'POST' })
      if (response.ok) {
        const data = await response.json()
        const discordMeta = data.user?.discord_meta
        if (discordMeta?.username) {
          setDiscordUsername(discordMeta.username)
        }
      }
    } catch (err) {
      console.warn('Failed to fetch Discord username:', err)
    }
  }

  if (!user?.isDiscordLinked) {
    return null // Don't show pill if not Discord linked
  }

  const displayName = discordUsername || user.display_name

  return (
    <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm border border-white/20 rounded-full px-3 py-1.5 shadow-lg">
      <Avatar userId={user.id} displayName={user.display_name} size={24} />
      <span className="text-sm text-white/90 font-medium">
        @{displayName}
      </span>
    </div>
  )
}
