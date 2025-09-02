import { useState, useEffect } from 'react'
import { useStation } from './hooks/useStation'
import NowPlaying from './components/NowPlaying'
import QueueList from './components/QueueList'
import SubmitForm from './components/SubmitForm'
import Reactions from './components/Reactions'
import { AdminPanel } from './components/AdminPanel'

function App() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const { currentTrack, playheadSeconds, queue, isLoading, error, refetch, advanceStation } = useStation()

  // Check for ?admin=1 in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const isAdmin = urlParams.get('admin') === '1'
    setShowAdminPanel(isAdmin)
  }, [])

  // Admin panel view
  if (showAdminPanel) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-6">
            <button
              onClick={() => {
                setShowAdminPanel(false)
                // Remove ?admin=1 from URL
                const url = new URL(window.location.href)
                url.searchParams.delete('admin')
                window.history.replaceState({}, '', url.toString())
              }}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              ← Back to Radio
            </button>
          </div>
          
          <AdminPanel />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            🎵 Agent DJ Radio
          </h1>
          <p className="text-lg text-gray-600">
            AI-generated music station - Queue tracks, react, and enjoy!
          </p>
        </header>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">
              <strong>Error:</strong> {error}
            </p>
            <button
              onClick={refetch}
              className="mt-2 px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
            >
              Retry
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Left Column */}
          <div className="space-y-6">
            <NowPlaying
              track={currentTrack}
              playheadSeconds={playheadSeconds}
              isLoading={isLoading}
              onAdvance={advanceStation}
            />
            
            <Reactions
              track={currentTrack}
              userId={currentUserId}
              onReactionSuccess={refetch}
            />
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            <SubmitForm onSubmitSuccess={refetch} />
            
            <QueueList
              queue={queue}
              isLoading={isLoading}
            />
          </div>
        </div>

        {/* Debug Controls (Sprint 1 only) */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-8">
          <h3 className="text-lg font-medium text-yellow-800 mb-3">
            Debug Controls (Sprint 1)
          </h3>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={advanceStation}
              className="px-3 py-1 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600"
            >
              Force Advance Station
            </button>
            <button
              onClick={refetch}
              className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
            >
              Refresh Station State
            </button>
            <button
              onClick={() => {
                fetch('/api/worker/generate', { method: 'POST' })
                  .then(() => refetch())
                  .catch(console.error)
              }}
              className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
            >
              Trigger Generation
            </button>
          </div>
          <p className="text-xs text-yellow-700 mt-2">
            These controls will be removed in production
          </p>
        </div>

        <footer className="text-center mt-8 text-sm text-gray-500">
          <p>
            Agent DJ Radio Sprint 3 MVP - Admin controls available
          </p>
          {/* Hidden admin link for development - only show in dev mode */}
          {import.meta.env.DEV && (
            <div className="mt-2">
              <button
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.set('admin', '1')
                  window.location.href = url.toString()
                }}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Admin Panel
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}

export default App