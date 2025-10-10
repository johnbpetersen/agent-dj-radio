import { useState, useEffect } from 'react'
import { useEphemeralUser } from '../hooks/useEphemeralUser'

// The shape of a message remains the same
interface ChatMessage {
  id: string
  display_name: string
  message: string
  created_at: string
  user_id?: string // Add user_id to map messages to avatars
}

interface ChatBoxProps {
  // This component now takes callbacks to pass data up to the parent
  onMessagesUpdate: (messages: ChatMessage[]) => void
}

// This component is now "headless" - it has logic but renders nothing.
export default function ChatBox({ onMessagesUpdate }: ChatBoxProps) {
  const { user, sessionId } = useEphemeralUser()
  const [isChatEnabled, setIsChatEnabled] = useState(false)

  // Check if chat feature is enabled
  useEffect(() => {
    const checkChatEnabled = async () => {
      try {
        const response = await fetch('/api/chat/recent?limit=1', { method: 'HEAD' })
        setIsChatEnabled(response.status !== 404)
      } catch (err) {
        setIsChatEnabled(false)
      }
    }
    checkChatEnabled()
  }, [])

  // Fetch recent messages and set up polling
  useEffect(() => {
    if (!isChatEnabled || !user) return

    let mounted = true
    const intervalId = setInterval(async () => {
      try {
        const response = await fetch('/api/chat/recent?limit=50')
        if (!mounted || !response.ok) return
        const data = await response.json()
        // Pass the fetched messages up to the parent component
        onMessagesUpdate(data.messages || [])
      } catch (err) {
        console.warn('Failed to fetch messages:', err)
      }
    }, 5000) // Poll every 5 seconds

    // Initial fetch
    const fetchInitial = async () => {
      const response = await fetch('/api/chat/recent?limit=50')
      if (response.ok) onMessagesUpdate((await response.json()).messages || [])
    }
    fetchInitial();


    return () => {
      mounted = false
      clearInterval(intervalId)
    }
  }, [isChatEnabled, user, onMessagesUpdate])

  // We need a way for other components to send messages.
  // We'll attach a function to the window object for this.
  useEffect(() => {
    if (!sessionId || !user) return;

    (window as any).__sendMessage = async (message: string) => {
      if (!message.trim()) return false
      try {
        const response = await fetch('/api/chat/post', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId
          },
          body: JSON.stringify({ message: message.trim() })
        })
        return response.ok
      } catch (err) {
        console.error('Failed to send message:', err)
        return false
      }
    };

    return () => {
      delete (window as any).__sendMessage
    }
  }, [sessionId, user])


  // This component renders nothing visible.
  return null
}