// ChatPanel - Full-featured chat UI for all users with active sessions

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, MessageCircle, Send } from 'lucide-react'
import { useEphemeralUser } from '../../../hooks/useEphemeralUser'
import { apiFetch } from '../../../lib/api'
import Avatar from '../Avatar'

interface ChatMessage {
  id: string
  user_id: string
  display_name: string
  message: string
  created_at: string
}

export default function ChatPanel() {
  const [isOpen, setIsOpen] = useState(true)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isChatEnabled, setIsChatEnabled] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { identity, loading } = useEphemeralUser()

  // Check if chat feature is enabled
  useEffect(() => {
    const checkChatEnabled = async () => {
      try {
        const response = await fetch('/api/chat/recent?limit=1')
        setIsChatEnabled(response.status !== 404)
      } catch (err) {
        setIsChatEnabled(false)
      }
    }
    checkChatEnabled()
  }, [])

  // Fetch messages and set up polling
  useEffect(() => {
    if (!isChatEnabled) return

    let mounted = true

    const fetchMessages = async () => {
      try {
        const response = await fetch('/api/chat/recent?limit=50')
        if (!mounted || !response.ok) return
        const data = await response.json()
        setMessages(data.messages || [])
      } catch (err) {
        console.warn('Failed to fetch messages:', err)
      }
    }

    // Initial fetch
    fetchMessages()

    // Poll every 5 seconds
    const intervalId = setInterval(fetchMessages, 5000)

    return () => {
      mounted = false
      clearInterval(intervalId)
    }
  }, [isChatEnabled])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || sending) return

    setError(null)
    setSending(true)

    try {
      const response = await apiFetch('/api/chat/post', {
        method: 'POST',
        body: JSON.stringify({ message: inputMessage.trim() })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))

        if (response.status === 429) {
          setError(errorData.message || 'Too many messages. Please wait.')
        } else {
          setError(errorData.error || 'Failed to send message')
        }
        return
      }

      // Success - clear input and fetch new messages
      setInputMessage('')
      // Immediately fetch to show new message
      const refreshResponse = await fetch('/api/chat/recent?limit=50')
      if (refreshResponse.ok) {
        const data = await refreshResponse.json()
        setMessages(data.messages || [])
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      setError('Network error. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  if (!isChatEnabled) {
    return null // Chat feature not enabled
  }

  return (
    <div className="absolute top-1/2 -translate-y-1/2 right-0 z-20">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="w-80 h-[60vh] bg-black/40 backdrop-blur-sm rounded-l-lg shadow-2xl flex flex-col"
          >
            {/* Header */}
            <h3 className="text-sm font-semibold text-white/80 p-4 border-b border-white/10 flex items-center">
              <MessageCircle className="w-4 h-4 mr-2" />
              Chat {messages.length > 0 && `(${messages.length})`}
            </h3>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {messages.length === 0 ? (
                <div className="text-center text-white/40 text-sm mt-8">
                  No messages yet. Be the first to chat!
                </div>
              ) : (
                messages.map((msg) => {
                  // Use session avatar for self messages (no network call)
                  const isSelf = identity?.userId === msg.user_id
                  const hintedAvatar = isSelf ? identity?.avatarUrl : undefined

                  return (
                    <div key={msg.id} className="flex items-start gap-2">
                      <Avatar
                        userId={msg.user_id}
                        displayName={msg.display_name}
                        size={32}
                        className="flex-shrink-0"
                        hintedUrl={hintedAvatar}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white/60 font-medium">
                          {msg.display_name}
                        </div>
                        <div className="text-sm text-white/90 break-words">
                          {msg.message}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="p-3 border-t border-white/10">
              {loading ? (
                // Loading state - hydration-safe
                <div className="bg-black/30 border border-white/20 rounded-lg p-3 text-center">
                  <div className="animate-pulse text-sm text-white/60">
                    Loading session...
                  </div>
                </div>
              ) : (
                // Chat input for all users
                <>
                  {error && (
                    <div className="mb-2 text-xs text-red-300 bg-red-500/20 px-2 py-1 rounded">
                      {error}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type a message..."
                      disabled={sending}
                      className="flex-1 bg-black/30 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!inputMessage.trim() || sending}
                      className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white p-2 rounded-lg transition-colors flex items-center justify-center"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute top-1/2 -translate-y-1/2 -left-8 w-8 h-16 bg-black/40 backdrop-blur-sm rounded-l-lg text-white/50 hover:bg-black/60 hover:text-white flex items-center justify-center transition-colors"
      >
        {isOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
    </div>
  )
}
