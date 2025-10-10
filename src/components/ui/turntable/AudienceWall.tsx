import { useState, useMemo, useEffect, useRef } from 'react' // FIX: Added 'useRef' to the import
import type { Track } from '../../../types'
import Avatar from './Avatar'
import SpeechBubble from './SpeechBubble'

interface ChatMessage {
  id: string
  display_name: string
  message: string
  created_at: string
  user_id?: string
}

interface AudienceWallProps {
  queue: Track[]
  currentTrack: Track | null
  messages: ChatMessage[]
  className?: string
}

interface ActiveMessage extends ChatMessage {
  displayUntil: number
}

export default function AudienceWall({ queue, currentTrack, messages, className = '' }: AudienceWallProps) {
  const [activeMessages, setActiveMessages] = useState<Map<string, ActiveMessage>>(new Map())
  // FIX: Changed React.useRef to useRef
  const lastMessagesRef = useRef<ChatMessage[]>([]);

  const allAudience = useMemo(() => {
    const users = new Map<string, { id: string, name: string }>()
    if (currentTrack?.user) {
      users.set(currentTrack.user.id, {
        id: currentTrack.user.id,
        name: currentTrack.user.display_name,
      })
    }
    queue.forEach(track => {
      if (track.user && !users.has(track.user.id)) {
        users.set(track.user.id, {
          id: track.user.id,
          name: track.user.display_name,
        })
      }
    })
    return Array.from(users.values())
  }, [queue, currentTrack])

  useEffect(() => {
    const lastKnownMessageIds = new Set(lastMessagesRef.current.map(m => m.id))
    const newMessages = messages.filter(m => !lastKnownMessageIds.has(m.id))

    if (newMessages.length > 0) {
      setActiveMessages(prev => {
        const newMap = new Map(prev)
        newMessages.forEach(msg => {
          if (msg.user_id) {
            newMap.set(msg.user_id, {
              ...msg,
              displayUntil: Date.now() + 7000,
            })
          }
        })
        return newMap
      })
    }

    lastMessagesRef.current = messages
  }, [messages])

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setActiveMessages(prev => {
        const newMap = new Map(prev)
        let changed = false
        for (const [userId, msg] of newMap.entries()) {
          if (now > msg.displayUntil) {
            newMap.delete(userId)
            changed = true
          }
        }
        return changed ? newMap : prev
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [])


  return (
    <div className={`bg-black/30 rounded-lg h-full w-full flex items-end justify-center p-4 ${className}`}>
      {allAudience.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-3 opacity-40">👥</div>
          <div className="text-white/60 font-medium">The room is empty</div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center items-end gap-x-6 gap-y-2">
          {allAudience.map((user, index) => {
            const activeMessage = activeMessages.get(user.id)
            return (
              <div
                key={user.id}
                className="relative flex flex-col items-center group animate-bob"
                style={{ animationDelay: `${index * 200}ms` }}
              >
                {activeMessage && (
                  <SpeechBubble
                    message={activeMessage.message}
                    className="absolute -top-10"
                  />
                )}
                <Avatar name={user.name} size="md" />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}