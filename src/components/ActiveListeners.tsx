import { useState, useEffect } from 'react'

interface ActiveUser {
  id: string
  display_name: string
}

// This component is now styled for our dark, immersive theme.
export default function ActiveListeners({ className = '' }: { className?: string }) {
  // FIX: Removed the extra '=' on this line
  const [users, setUsers] = useState<ActiveUser[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    const fetchActiveUsers = async () => {
      try {
        const response = await fetch('/api/users/active?window_secs=120')
        if (!mounted || !response.ok) return
        const data = await response.json()
        setUsers(data.users || [])
      } catch (err) {
        console.warn('Failed to fetch active users:', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchActiveUsers()
    const intervalId = setInterval(fetchActiveUsers, 10000)
    return () => {
      mounted = false
      clearInterval(intervalId)
    }
  }, [])

  return (
    <div className={`p-4 text-white ${className}`}>
      {loading && users.length === 0 ? (
        <div className="text-center text-white/60 p-8">Loading...</div>
      ) : users.length === 0 ? (
        <div className="text-center text-white/60 p-8">No one else is here.</div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center space-x-3 p-2 rounded-md hover:bg-white/10 transition-colors"
            >
              <div className="w-2 h-2 bg-green-400 rounded-full" />
              <p className="text-sm font-medium text-white/90 truncate">
                {user.display_name}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}