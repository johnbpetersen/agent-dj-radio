import type { Track } from '../types'

interface QueueListProps {
  queue: Track[]
  isLoading: boolean
}

const statusColors = {
  PAID: 'bg-green-100 text-green-800',
  GENERATING: 'bg-yellow-100 text-yellow-800',
  READY: 'bg-blue-100 text-blue-800',
  PLAYING: 'bg-purple-100 text-purple-800'
} as const

const statusLabels = {
  PAID: 'Paid',
  GENERATING: 'Generating...',
  READY: 'Ready',
  PLAYING: 'Playing'
} as const

function formatPrice(price: number): string {
  return price > 0 ? `$${price.toFixed(2)}` : 'Free'
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function QueueList({ queue, isLoading }: QueueListProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Queue</h2>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Queue</h2>
        <p className="text-gray-600 text-center py-8">
          No tracks in queue. Submit a track to get started!
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        Queue ({queue.length})
      </h2>
      
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {queue.map((track, index) => (
          <div
            key={track.id}
            className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-500">
                    #{index + 1}
                  </span>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      statusColors[track.status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {statusLabels[track.status as keyof typeof statusLabels] || track.status}
                  </span>
                  {track.source === 'REPLAY' && (
                    <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs">
                      REPLAY
                    </span>
                  )}
                </div>
                
                <h3 className="font-medium text-gray-900 truncate mb-1">
                  {track.prompt}
                </h3>
                
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  {track.user && (
                    <span>by {track.user.display_name}</span>
                  )}
                  <span>{formatDuration(track.duration_seconds)}</span>
                  <span>{formatPrice(track.price_usd)}</span>
                </div>
              </div>
              
              {track.rating_count > 0 && (
                <div className="text-sm text-gray-600 ml-4">
                  ★ {track.rating_score?.toFixed(1)} ({track.rating_count})
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}