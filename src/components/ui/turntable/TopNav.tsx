import { useState } from 'react'
import { useIdentity } from '../../../hooks/useIdentity'
import { ChevronDown } from 'lucide-react'
import ProfileRename from '../../ProfileRename'

interface TopNavProps {
  onQueueTrack: () => void
  className?: string
}

export default function TopNav({ onQueueTrack, className = '' }: TopNavProps) {
  const { identity, loading } = useIdentity()
  const [showRename, setShowRename] = useState(false)

  return (
    <nav className={className}>
      <div className="flex items-center justify-between gap-3">
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

        {/* Identity display */}
        <div className="relative">
          {loading ? (
            <div className="bg-black/30 px-4 py-2 rounded-lg animate-pulse">
              <div className="h-4 w-32 bg-white/20 rounded"></div>
            </div>
          ) : identity ? (
            <div>
              <button
                onClick={() => setShowRename(!showRename)}
                className="bg-black/40 hover:bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/20 text-white/90 transition-colors flex items-center gap-2"
              >
                <span className="font-medium">{identity.displayName}</span>
                {identity.ephemeral && (
                  <span className="text-xs px-2 py-0.5 bg-white/10 rounded-full text-white/60">
                    guest
                  </span>
                )}
                <ChevronDown className="w-4 h-4 text-white/50" />
              </button>

              {/* Rename dropdown */}
              {showRename && (
                <div className="absolute right-0 top-full mt-2 z-50">
                  <ProfileRename onClose={() => setShowRename(false)} />
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  )
}
