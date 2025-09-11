// ActiveListeners component - Shows currently active ephemeral users
// Polls /api/users/active every 10 seconds

import { useState, useEffect } from 'react'

interface ActiveUser {
  id: string
  display_name: string
  bio: string | null
  is_agent: boolean
}

interface ActiveListenersProps {
  className?: string
}

export default function ActiveListeners({ className = '' }: ActiveListenersProps) {
  const [users, setUsers] = useState<ActiveUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    let intervalId: NodeJS.Timeout | null = null

    const fetchActiveUsers = async () => {
      try {
        const response = await fetch('/api/users/active?window_secs=120', {
          method: 'GET'
        })

        if (!mounted) return

        if (!response.ok) {
          if (response.status === 404) {
            // Feature not enabled
            setUsers([])
            setLoading(false)
            return
          }
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()
        setUsers(data.users || [])
        setError(null)
      } catch (err) {
        if (mounted) {
          console.warn('Failed to fetch active users:', err)
          setError('Failed to load active users')
          // Don't clear existing users on error
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    // Initial fetch
    fetchActiveUsers()

    // Set up polling every 10 seconds
    intervalId = setInterval(fetchActiveUsers, 10000)

    return () => {
      mounted = false
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [])

  // Don't show anything while initially loading
  if (loading && users.length === 0) {
    return null
  }

  // Don't show if no users and feature seems disabled
  if (!loading && users.length === 0 && !error) {
    return null
  }

  return (
    <div className={`${className}`}>
      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-800">
            Active Listeners
            {users.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-600">
                ({users.length})
              </span>
            )}
          </h3>
          {loading && (
            <div className="text-xs text-gray-500">
              Updating...
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-600 mb-2">
            {error}
          </div>
        )}

        {users.length === 0 ? (
          <div className="text-sm text-gray-500 italic">
            No active listeners right now
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-start space-x-3 p-2 rounded-md hover:bg-gray-50 transition-colors"
              >
                <div className="flex-shrink-0">
                  {user.is_agent ? (
                    <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                      <span className="text-sm text-purple-600 font-semibold">🤖</span>
                    </div>
                  ) : (
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-sm text-blue-600 font-semibold">
                        {user.display_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="w-2 h-2 bg-green-400 rounded-full mt-1 ml-6 -translate-x-1"></div>
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {user.display_name}
                    </p>
                    {user.is_agent && (
                      <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full">
                        AI
                      </span>
                    )}
                  </div>
                  
                  {user.bio && (
                    <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                      {user.bio}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}