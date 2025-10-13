import DiscordLoginButton from '../../DiscordLoginButton'
import { useEphemeralUser } from '../../../hooks/useEphemeralUser'

interface TopNavProps {
  onQueueTrack: () => void
  className?: string
}

// The TopNav is now just a single, clean button.
export default function TopNav({ onQueueTrack, className = '' }: TopNavProps) {
  const { user } = useEphemeralUser()

  return (
    <nav className={className}>
      <div className="flex items-center gap-3">
        <button
          onClick={onQueueTrack}
          className="
            bg-gradient-to-r from-blue-500 to-purple-600
            hover:from-blue-600 hover:to-purple-700
            text-white font-bold px-5 py-3 rounded-lg
            shadow-lg border border-white/20
            transition-all duration-200 transform hover:scale-105
            focus:outline-none focus:ring-2 focus:ring-white/50
            group
          "
        >
          <div className="flex items-center gap-2">
            <span className="text-xl group-hover:rotate-12 transition-transform">🎤</span>
            <span>Queue a Track</span>
          </div>
        </button>

        {user && !user.isDiscordLinked && <DiscordLoginButton />}
      </div>
    </nav>
  )
}