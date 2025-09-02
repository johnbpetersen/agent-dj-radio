import { useMemo } from 'react'
import type { Track } from '../../../types'
import Avatar from './Avatar'

interface AudienceWallProps {
  queue: Track[]
  currentTrack: Track | null
  className?: string
}

// Generate some fake audience members to make the room feel alive
const generateFakeAudience = () => {
  const names = [
    'Alex', 'Sam', 'Jordan', 'Casey', 'Riley', 'Quinn', 'Avery', 'Morgan',
    'Jamie', 'Taylor', 'Sage', 'Phoenix', 'River', 'Sky', 'Rain', 'Ocean',
    'Luna', 'Star', 'Nova', 'Cosmos', 'Neo', 'Zoe', 'Max', 'Kai'
  ]
  
  return names.map((name, index) => ({
    id: `fake-${index}`,
    name,
    isOnline: Math.random() > 0.3, // 70% appear online
    lastSeen: Math.random() * 10 // minutes ago
  }))
}

export default function AudienceWall({ queue, currentTrack, className = '' }: AudienceWallProps) {
  // Get real users from queue and current track
  const realUsers = useMemo(() => {
    const users = new Map()
    
    // Add current track user
    if (currentTrack?.user) {
      users.set(currentTrack.user.id, {
        id: currentTrack.user.id,
        name: currentTrack.user.display_name,
        isOnline: true,
        isDJ: true
      })
    }
    
    // Add queue users
    queue.forEach(track => {
      if (track.user && !users.has(track.user.id)) {
        users.set(track.user.id, {
          id: track.user.id,
          name: track.user.display_name,
          isOnline: true,
          isDJ: false
        })
      }
    })
    
    return Array.from(users.values())
  }, [queue, currentTrack])
  
  // Mix real users with fake audience for a lively feel
  const allAudience = useMemo(() => {
    const fakeAudience = generateFakeAudience()
    
    // Combine real users (first) with some fake users
    return [
      ...realUsers,
      ...fakeAudience.slice(0, 20 - realUsers.length) // Fill up to ~20 total
    ].slice(0, 24) // Cap at 24 for good grid layout
  }, [realUsers])

  return (
    <div className={`glass-card ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Audience</h2>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            <span className="text-white/70 text-sm">
              {allAudience.filter(user => user.isOnline).length} online
            </span>
          </div>
        </div>
      </div>
      
      {/* Audience Grid */}
      <div className="p-4">
        {allAudience.length === 0 ? (
          // Empty state
          <div className="text-center py-8">
            <div className="text-4xl mb-3 opacity-20">👥</div>
            <div className="text-white/60 font-medium mb-2">No one here yet</div>
            <div className="text-white/40 text-sm">
              Queue a track to join the party!
            </div>
          </div>
        ) : (
          // Audience grid
          <div className="grid grid-cols-6 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {allAudience.map((user, index) => (
              <div
                key={user.id}
                className="flex flex-col items-center group"
                style={{ 
                  animationDelay: `${index * 50}ms`,
                  animation: 'bounce-in 0.6s ease-out forwards'
                }}
              >
                <Avatar
                  name={user.name}
                  size="md"
                  isOnline={user.isOnline}
                  isDJ={user.isDJ}
                  className="mb-2"
                />
                <div className="text-white/70 text-xs text-center truncate w-full group-hover:text-white transition-colors">
                  {user.name}
                </div>
                {user.isDJ && (
                  <div className="text-yellow-400 text-xs font-bold mt-1">
                    DJ
                  </div>
                )}
                {!user.isOnline && 'lastSeen' in user && (
                  <div className="text-white/40 text-xs mt-1">
                    {Math.round(user.lastSeen)}m ago
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Footer with stats */}
      <div className="px-4 pb-4">
        <div className="text-center">
          <div className="text-white/40 text-xs">
            {realUsers.length > 0 && (
              <span>{realUsers.length} active DJs • </span>
            )}
            Room capacity: {allAudience.length}/24
          </div>
        </div>
      </div>
    </div>
  )
}