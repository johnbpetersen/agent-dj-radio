interface TopNavProps {
  onQueueTrack: () => void
  className?: string
}

export default function TopNav({ onQueueTrack, className = '' }: TopNavProps) {
  return (
    <nav className={`glass-card-dark ${className}`}>
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo/Brand */}
          <div className="flex items-center gap-3">
            <div className="text-3xl">🎵</div>
            <div>
              <h1 className="text-2xl font-bold text-white">
                Agent DJ Radio
              </h1>
              <p className="text-white/70 text-sm hidden sm:block">
                AI-powered music station
              </p>
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex items-center gap-4">
            {/* Queue Track Button */}
            <button
              onClick={onQueueTrack}
              className="
                bg-gradient-to-r from-blue-500 to-purple-600 
                hover:from-blue-600 hover:to-purple-700
                text-white font-bold px-6 py-3 rounded-xl
                shadow-lg border border-white/20
                transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-white/50
                group
              "
            >
              <div className="flex items-center gap-2">
                <span className="text-xl group-hover:scale-110 transition-transform">🎤</span>
                <span className="hidden sm:inline">Queue a Track</span>
                <span className="sm:hidden">Queue</span>
              </div>
            </button>
            
            {/* Admin Link - Dev Only */}
            {import.meta.env.DEV && (
              <button
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.set('admin', '1')
                  window.location.href = url.toString()
                }}
                className="
                  text-white/60 hover:text-white text-sm
                  px-3 py-2 rounded-lg
                  border border-white/20 hover:border-white/40
                  transition-all duration-200
                  focus:outline-none focus:ring-2 focus:ring-white/30
                "
                title="Admin Panel"
              >
                <span className="hidden sm:inline">Admin</span>
                <span className="sm:hidden text-lg">⚙️</span>
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Optional status bar */}
      <div className="px-6 pb-2">
        <div className="flex items-center justify-center text-white/50 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span>Live • AI-generated music radio</span>
          </div>
        </div>
      </div>
    </nav>
  )
}