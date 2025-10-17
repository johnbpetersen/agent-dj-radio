// UserChip - Display user avatar + handle with fallback letter avatar
// Used for attribution ("Requested by", "Paid by") in Now Playing and Queue

import { useUserAvatar } from '../../hooks/useUserAvatar'
import { displayHandle, fallbackName, getAvatarColor, getInitials } from '../../utils/formatUser'

interface UserChipProps {
  /** User ID for avatar fetch (null for guests) */
  userId: string | null
  /** Fallback display name if userId is null or unknown */
  fallbackName?: string | null
  /** Optional CSS classes */
  className?: string
}

/**
 * UserChip component - shows avatar + handle for attribution
 *
 * Behavior:
 * - If userId provided: fetches provider avatar, shows handle or fallback
 * - If userId null: shows letter avatar for fallback name or "Guest"
 * - Graceful loading: skeleton during fetch, no layout shift
 * - Tooltip shows full handle (useful for long names)
 */
export default function UserChip({ userId, fallbackName: fallbackNameProp, className = '' }: UserChipProps) {
  const { avatarUrl, isLoading } = useUserAvatar(userId)

  // Construct user object for helper functions
  const userInfo = {
    id: userId,
    display_name: fallbackNameProp
  }

  const handle = displayHandle(userInfo)
  const name = fallbackName(userInfo)

  // Determine avatar display
  const showLetterAvatar = !avatarUrl && !isLoading
  const avatarBgColor = getAvatarColor(name)
  const initials = getInitials(name)

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={handle}
    >
      {/* Avatar Container - fixed size to prevent layout shift */}
      <span className="relative inline-flex w-6 h-6 rounded-full overflow-hidden flex-shrink-0">
        {isLoading && (
          // Skeleton loader
          <span className="absolute inset-0 bg-white/20 animate-pulse" />
        )}

        {showLetterAvatar && (
          // Letter avatar fallback
          <span
            className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white"
            style={{ backgroundColor: avatarBgColor }}
          >
            {initials}
          </span>
        )}

        {avatarUrl && !isLoading && (
          // Provider avatar
          <img
            src={avatarUrl}
            alt={handle}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </span>

      {/* Handle text - ellipsize if too long */}
      <span className="text-sm truncate max-w-[120px]">
        {handle}
      </span>
    </span>
  )
}
