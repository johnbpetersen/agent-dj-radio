import { useState, useEffect } from 'react'

interface HealthStatus {
  timestamp: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  services: {
    database: { status: 'up' | 'down', latency_ms?: number, error?: string }
    eleven_labs: { status: 'up' | 'down', error?: string }
    storage: { status: 'up' | 'down', error?: string }
  }
  system: {
    uptime_minutes: number
    feature_flags: {
      ENABLE_X402: boolean
      ENABLE_REAL_ELEVEN: boolean
      ENABLE_REQUEST_LOGGING: boolean
      ENABLE_ERROR_TRACKING: boolean
    }
    queue_stats: {
      total_tracks: number
      ready_tracks: number
      generating_tracks: number
      failed_tracks: number
    }
    recent_activity: {
      tracks_submitted_last_hour: number
      tracks_generated_last_hour: number
      station_advances_last_hour: number
    }
  }
}

export function HealthDashboard() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchHealth = async () => {
    try {
      setError(null)
      const response = await fetch('/api/health')
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`)
      }
      
      const data = await response.json()
      setHealth(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    
    if (autoRefresh) {
      const interval = setInterval(fetchHealth, 30000) // Refresh every 30 seconds
      return () => clearInterval(interval)
    }
  }, [autoRefresh])

  const getStatusColor = (status: 'healthy' | 'degraded' | 'unhealthy' | 'up' | 'down') => {
    switch (status) {
      case 'healthy':
      case 'up':
        return 'text-green-600 bg-green-100'
      case 'degraded':
        return 'text-yellow-600 bg-yellow-100'
      case 'unhealthy':
      case 'down':
        return 'text-red-600 bg-red-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  const formatUptime = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center">
          <h3 className="text-lg font-medium text-red-600 mb-2">Health Check Failed</h3>
          <p className="text-sm text-red-500 mb-4">{error}</p>
          <button
            onClick={fetchHealth}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!health) return null

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-gray-900">System Health</h3>
          <div className="flex items-center gap-3">
            <label className="flex items-center text-sm">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="mr-1"
              />
              Auto-refresh
            </label>
            <button
              onClick={fetchHealth}
              className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Overall Status */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${getStatusColor(health.status)}`}>
              {health.status.toUpperCase()}
            </span>
            <span className="text-xs text-gray-500">
              Last updated: {new Date(health.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Services Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">Database</h4>
              <span className={`px-2 py-1 text-xs rounded ${getStatusColor(health.services.database.status)}`}>
                {health.services.database.status}
              </span>
            </div>
            {health.services.database.latency_ms && (
              <p className="text-xs text-gray-500">
                Latency: {health.services.database.latency_ms}ms
              </p>
            )}
            {health.services.database.error && (
              <p className="text-xs text-red-500 mt-1">{health.services.database.error}</p>
            )}
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">ElevenLabs</h4>
              <span className={`px-2 py-1 text-xs rounded ${getStatusColor(health.services.eleven_labs.status)}`}>
                {health.services.eleven_labs.status}
              </span>
            </div>
            {health.services.eleven_labs.error && (
              <p className="text-xs text-red-500 mt-1">{health.services.eleven_labs.error}</p>
            )}
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">Storage</h4>
              <span className={`px-2 py-1 text-xs rounded ${getStatusColor(health.services.storage.status)}`}>
                {health.services.storage.status}
              </span>
            </div>
            {health.services.storage.error && (
              <p className="text-xs text-red-500 mt-1">{health.services.storage.error}</p>
            )}
          </div>
        </div>

        {/* Feature Flags */}
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Feature Flags</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(health.system.feature_flags).map(([flag, enabled]) => (
              <div key={flag} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${enabled ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                <span className="text-xs text-gray-600">{flag}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Queue Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{health.system.queue_stats.total_tracks}</div>
            <div className="text-xs text-gray-500">Total Tracks</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{health.system.queue_stats.ready_tracks}</div>
            <div className="text-xs text-gray-500">Ready</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-600">{health.system.queue_stats.generating_tracks}</div>
            <div className="text-xs text-gray-500">Generating</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{health.system.queue_stats.failed_tracks}</div>
            <div className="text-xs text-gray-500">Failed</div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="text-center bg-blue-50 rounded-lg p-3">
            <div className="text-lg font-bold text-blue-600">{health.system.recent_activity.tracks_submitted_last_hour}</div>
            <div className="text-xs text-blue-500">Submitted (1h)</div>
          </div>
          <div className="text-center bg-green-50 rounded-lg p-3">
            <div className="text-lg font-bold text-green-600">{health.system.recent_activity.tracks_generated_last_hour}</div>
            <div className="text-xs text-green-500">Generated (1h)</div>
          </div>
          <div className="text-center bg-purple-50 rounded-lg p-3">
            <div className="text-lg font-bold text-purple-600">{health.system.recent_activity.station_advances_last_hour}</div>
            <div className="text-xs text-purple-500">Advances (1h)</div>
          </div>
        </div>

        {/* System Info */}
        <div className="text-center pt-4 border-t">
          <p className="text-xs text-gray-500">
            System uptime: {formatUptime(health.system.uptime_minutes)}
          </p>
        </div>
      </div>
    </div>
  )
}