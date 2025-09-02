import { useState, useEffect } from 'react'
import { adminApi } from '../lib/admin'

interface AdminState {
  station_state: {
    id: number
    current_track: any
    current_track_id: string | null
    current_started_at: string | null
  }
  queue: any[]
  recent_tracks?: any[]
  playhead_seconds: number
}

export function AdminPanel() {
  const [adminToken, setAdminToken] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [adminState, setAdminState] = useState<AdminState | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Load token from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('adminToken')
    if (savedToken) {
      setAdminToken(savedToken)
      testAuthentication(savedToken)
    }
  }, [])

  const testAuthentication = async (token?: string) => {
    const tokenToTest = token || adminToken
    if (!tokenToTest) return

    localStorage.setItem('adminToken', tokenToTest)
    const isValid = await adminApi.testAuth()
    setIsAuthenticated(isValid)
    
    if (isValid) {
      setError('')
      refreshState()
    } else {
      setError('Invalid admin token')
    }
  }

  const refreshState = async () => {
    if (!isAuthenticated) return

    setLoading(true)
    const result = await adminApi.getState()
    
    if (result.success) {
      setAdminState(result.data)
      setError('')
    } else {
      setError(`Failed to fetch state: ${result.error}`)
    }
    setLoading(false)
  }

  const handleGenerate = async () => {
    setLoading(true)
    const result = await adminApi.generate()
    
    if (result.success) {
      setMessage(result.data.message || 'Generation triggered')
      setError('')
      // Refresh state after a moment
      setTimeout(refreshState, 1000)
    } else {
      setError(`Generate failed: ${result.error}`)
    }
    setLoading(false)
  }

  const handleAdvance = async () => {
    setLoading(true)
    const result = await adminApi.advance()
    
    if (result.success) {
      setMessage(result.data.message || 'Station advanced')
      setError('')
      refreshState()
    } else {
      setError(`Advance failed: ${result.error}`)
    }
    setLoading(false)
  }

  const handleTrackAction = async (trackId: string, action: 'skip' | 'requeue' | 'delete') => {
    setLoading(true)
    let result

    switch (action) {
      case 'skip':
        result = await adminApi.skipTrack(trackId)
        break
      case 'requeue':
        result = await adminApi.requeueTrack(trackId)
        break
      case 'delete':
        result = await adminApi.deleteTrack(trackId)
        break
    }
    
    if (result.success) {
      setMessage(result.data.message || `Track ${action} successful`)
      setError('')
      refreshState()
    } else {
      setError(`${action} failed: ${result.error}`)
    }
    setLoading(false)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto bg-red-50 border border-red-200 rounded-lg p-6">
        <h2 className="text-xl font-bold text-red-800 mb-4">🔧 Admin Panel</h2>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="adminToken" className="block text-sm font-medium text-gray-700 mb-2">
              Admin Token:
            </label>
            <input
              id="adminToken"
              type="password"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="Enter admin token"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          
          <button
            onClick={() => testAuthentication()}
            disabled={!adminToken || loading}
            className="w-full bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Authenticating...' : 'Connect'}
          </button>
          
          {error && (
            <div className="text-red-600 text-sm bg-red-100 p-2 rounded">
              {error}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto bg-red-50 border border-red-200 rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-red-800">🔧 Admin Panel</h2>
        <div className="flex gap-2">
          <button
            onClick={refreshState}
            disabled={loading}
            className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('adminToken')
              setIsAuthenticated(false)
              setAdminState(null)
            }}
            className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {message && (
        <div className="bg-green-100 text-green-800 p-3 rounded mb-4">
          {message}
        </div>
      )}
      
      {error && (
        <div className="bg-red-100 text-red-800 p-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Control Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          🎵 Generate Track
        </button>
        
        <button
          onClick={handleAdvance}
          disabled={loading}
          className="bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 disabled:opacity-50 font-medium"
        >
          ⏭️ Advance Station
        </button>
        
        <button
          onClick={refreshState}
          disabled={loading}
          className="bg-gray-600 text-white py-3 px-4 rounded-md hover:bg-gray-700 disabled:opacity-50 font-medium"
        >
          🔄 Refresh State
        </button>
      </div>

      {/* Current State */}
      {adminState && (
        <div className="space-y-6">
          {/* Now Playing */}
          <div className="bg-white rounded-lg p-4 border">
            <h3 className="text-lg font-semibold mb-3 text-gray-800">🎧 Now Playing</h3>
            {adminState.station_state.current_track ? (
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {adminState.station_state.current_track.prompt}
                    </p>
                    <p className="text-sm text-gray-600">
                      {formatTime(adminState.station_state.current_track.duration_seconds)} • 
                      Status: {adminState.station_state.current_track.status} • 
                      Rating: {adminState.station_state.current_track.rating_score || 0}
                    </p>
                    <p className="text-xs text-gray-500">
                      Playhead: {formatTime(Math.floor(adminState.playhead_seconds))}
                    </p>
                  </div>
                  <div className="flex gap-1 ml-4">
                    <button
                      onClick={() => handleTrackAction(adminState.station_state.current_track.id, 'skip')}
                      disabled={loading}
                      className="bg-orange-500 text-white px-2 py-1 rounded text-xs hover:bg-orange-600 disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 italic">No track currently playing</p>
            )}
          </div>

          {/* Queue */}
          <div className="bg-white rounded-lg p-4 border">
            <h3 className="text-lg font-semibold mb-3 text-gray-800">📋 Queue ({adminState.queue.length})</h3>
            {adminState.queue.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {adminState.queue.map((track: any) => (
                  <div key={track.id} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {track.prompt}
                      </p>
                      <p className="text-xs text-gray-600">
                        {formatTime(track.duration_seconds)} • 
                        Status: <span className={`font-mono ${
                          track.status === 'READY' ? 'text-green-600' :
                          track.status === 'PAID' ? 'text-blue-600' :
                          track.status === 'GENERATING' ? 'text-yellow-600' :
                          'text-gray-600'
                        }`}>{track.status}</span> • 
                        ${track.price_usd}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {track.status !== 'READY' && track.status !== 'GENERATING' && (
                        <button
                          onClick={() => handleTrackAction(track.id, 'requeue')}
                          disabled={loading}
                          className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600 disabled:opacity-50"
                        >
                          Requeue
                        </button>
                      )}
                      <button
                        onClick={() => handleTrackAction(track.id, 'delete')}
                        disabled={loading}
                        className="bg-red-500 text-white px-2 py-1 rounded text-xs hover:bg-red-600 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 italic">Queue is empty</p>
            )}
          </div>

          {/* Recent Tracks */}
          {adminState.recent_tracks && adminState.recent_tracks.length > 0 && (
            <div className="bg-white rounded-lg p-4 border">
              <h3 className="text-lg font-semibold mb-3 text-gray-800">📚 Recent Tracks</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {adminState.recent_tracks.map((track: any) => (
                  <div key={track.id} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {track.prompt}
                      </p>
                      <p className="text-xs text-gray-600">
                        Status: <span className={`font-mono ${
                          track.status === 'DONE' ? 'text-gray-600' :
                          track.status === 'FAILED' ? 'text-red-600' :
                          'text-gray-600'
                        }`}>{track.status}</span> • 
                        Rating: {track.rating_score || 0} ({track.rating_count || 0} votes)
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {track.status === 'DONE' && (
                        <button
                          onClick={() => handleTrackAction(track.id, 'requeue')}
                          disabled={loading}
                          className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600 disabled:opacity-50"
                        >
                          Requeue
                        </button>
                      )}
                      <button
                        onClick={() => handleTrackAction(track.id, 'delete')}
                        disabled={loading}
                        className="bg-red-500 text-white px-2 py-1 rounded text-xs hover:bg-red-600 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 text-xs text-gray-600">
        Admin panel for emergency operations. Use with caution in production.
      </div>
    </div>
  )
}