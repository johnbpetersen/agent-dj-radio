// ChatBox component - Basic chat interface for ephemeral users
// Only shown if ENABLE_CHAT_ALPHA flag is enabled

import { useState, useEffect, useRef } from 'react'
import { useEphemeralUser } from '../hooks/useEphemeralUser'

interface ChatMessage {
  id: string
  display_name: string
  message: string
  created_at: string
}

interface ChatBoxProps {
  className?: string
}

export default function ChatBox({ className = '' }: ChatBoxProps) {
  const { user, sessionId } = useEphemeralUser()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isPosting, setIsPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isChatEnabled, setIsChatEnabled] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Check if chat feature is enabled
  useEffect(() => {
    const checkChatEnabled = async () => {
      try {
        const response = await fetch('/api/chat/recent?limit=1', {
          method: 'HEAD'
        })
        
        setIsChatEnabled(response.status !== 404)
      } catch (err) {
        setIsChatEnabled(false)
      } finally {
        setIsLoading(false)
      }
    }

    checkChatEnabled()
  }, [])

  // Fetch recent messages and set up polling
  useEffect(() => {
    if (!isChatEnabled) return

    let mounted = true
    let intervalId: NodeJS.Timeout | null = null

    const fetchMessages = async () => {
      try {
        const response = await fetch('/api/chat/recent?limit=50')
        
        if (!mounted) return

        if (response.ok) {
          const data = await response.json()
          setMessages(data.messages || [])
          setError(null)
        } else if (response.status !== 404) {
          setError('Failed to load messages')
        }
      } catch (err) {
        if (mounted) {
          console.warn('Failed to fetch messages:', err)
          setError('Connection error')
        }
      }
    }

    // Initial fetch
    fetchMessages()

    // Poll for new messages every 5 seconds
    intervalId = setInterval(fetchMessages, 5000)

    return () => {
      mounted = false
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [isChatEnabled])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!newMessage.trim() || !sessionId || !user || isPosting) {
      return
    }

    if (newMessage.length > 200) {
      setError('Message too long (max 200 characters)')
      return
    }

    setIsPosting(true)
    setError(null)

    try {
      const response = await fetch('/api/chat/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId
        },
        body: JSON.stringify({
          message: newMessage.trim()
        })
      })

      if (response.ok) {
        setNewMessage('')
        
        // Immediately add optimistic update
        const optimisticMessage: ChatMessage = {
          id: `temp-${Date.now()}`,
          display_name: user.display_name,
          message: newMessage.trim(),
          created_at: new Date().toISOString()
        }
        
        setMessages(prev => [...prev, optimisticMessage])
        
        // Focus back to input
        if (inputRef.current) {
          inputRef.current.focus()
        }
      } else if (response.status === 429) {
        setError('Too many messages. Please slow down.')
      } else {
        const errorData = await response.json().catch(() => ({}))
        setError(errorData.error || 'Failed to send message')
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      setError('Network error')
    } finally {
      setIsPosting(false)
    }
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    
    if (diffMins < 1) return 'now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return date.toLocaleDateString()
  }

  // Don't render if loading or chat not enabled
  if (isLoading || !isChatEnabled) {
    return null
  }

  // Don't render if user not available
  if (!user) {
    return null
  }

  return (
    <div className={`${className}`}>
      <div className="bg-white rounded-lg shadow-md flex flex-col" style={{ height: '400px' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-800">Chat</h3>
          <span className="text-sm text-gray-500">
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-2">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}
          
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 text-sm italic">
              No messages yet. Be the first to say something!
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="flex space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-sm text-blue-600 font-semibold">
                      {message.display_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline space-x-2">
                    <p className="text-sm font-medium text-gray-900">
                      {message.display_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatTime(message.created_at)}
                    </p>
                  </div>
                  <p className="text-sm text-gray-700 mt-1 break-words">
                    {message.message}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t p-4">
          <form onSubmit={handleSendMessage} className="flex space-x-2">
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              maxLength={200}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isPosting}
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || isPosting}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPosting ? 'Sending...' : 'Send'}
            </button>
          </form>
          <div className="flex justify-between items-center mt-2">
            <p className="text-xs text-gray-500">
              {newMessage.length}/200 characters
            </p>
            <p className="text-xs text-gray-500">
              Posting as {user.display_name}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}