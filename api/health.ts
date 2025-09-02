import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './_shared/supabase'
import { secureHandler, securityConfigs } from './_shared/secure-handler'

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

async function healthHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const startTime = Date.now()
  const healthStatus: HealthStatus = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    services: {
      database: { status: 'down' },
      eleven_labs: { status: 'down' },
      storage: { status: 'down' }
    },
    system: {
      uptime_minutes: Math.floor(process.uptime() / 60),
      feature_flags: {
        ENABLE_X402: process.env.ENABLE_X402 === 'true',
        ENABLE_REAL_ELEVEN: process.env.ENABLE_REAL_ELEVEN === 'true',
        ENABLE_REQUEST_LOGGING: process.env.ENABLE_REQUEST_LOGGING === 'true',
        ENABLE_ERROR_TRACKING: process.env.ENABLE_ERROR_TRACKING === 'true'
      },
      queue_stats: {
        total_tracks: 0,
        ready_tracks: 0,
        generating_tracks: 0,
        failed_tracks: 0
      },
      recent_activity: {
        tracks_submitted_last_hour: 0,
        tracks_generated_last_hour: 0,
        station_advances_last_hour: 0
      }
    }
  }

  try {
    // Test database connection and get stats
    const dbStartTime = Date.now()
    
    // Get queue statistics
    const { data: tracks, error: tracksError } = await supabaseAdmin
      .from('tracks')
      .select('status, created_at')
      
    if (!tracksError && tracks) {
      healthStatus.services.database.status = 'up'
      healthStatus.services.database.latency_ms = Date.now() - dbStartTime
      
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      
      // Calculate queue stats
      healthStatus.system.queue_stats.total_tracks = tracks.length
      healthStatus.system.queue_stats.ready_tracks = tracks.filter(t => t.status === 'READY').length
      healthStatus.system.queue_stats.generating_tracks = tracks.filter(t => t.status === 'GENERATING').length
      healthStatus.system.queue_stats.failed_tracks = tracks.filter(t => t.status === 'FAILED').length
      
      // Calculate recent activity
      const recentTracks = tracks.filter(t => new Date(t.created_at) > oneHourAgo)
      healthStatus.system.recent_activity.tracks_submitted_last_hour = recentTracks.length
      healthStatus.system.recent_activity.tracks_generated_last_hour = recentTracks.filter(t => 
        t.status === 'READY' || t.status === 'PLAYING' || t.status === 'DONE'
      ).length
    } else {
      healthStatus.services.database.status = 'down'
      healthStatus.services.database.error = tracksError?.message || 'Database connection failed'
    }

    // Test ElevenLabs API (only if enabled)
    if (process.env.ENABLE_REAL_ELEVEN === 'true' && process.env.ELEVEN_API_KEY) {
      try {
        const elevenResponse = await fetch('https://api.elevenlabs.io/v1/user', {
          headers: {
            'xi-api-key': process.env.ELEVEN_API_KEY
          }
        })
        
        if (elevenResponse.ok) {
          healthStatus.services.eleven_labs.status = 'up'
        } else {
          healthStatus.services.eleven_labs.status = 'down'
          healthStatus.services.eleven_labs.error = `API returned ${elevenResponse.status}`
        }
      } catch (error) {
        healthStatus.services.eleven_labs.status = 'down'
        healthStatus.services.eleven_labs.error = error instanceof Error ? error.message : 'Unknown error'
      }
    } else {
      healthStatus.services.eleven_labs.status = 'up' // Mock mode
    }

    // Test storage (Supabase Storage)
    try {
      const { data: buckets, error: storageError } = await supabaseAdmin.storage.listBuckets()
      
      if (!storageError && buckets) {
        healthStatus.services.storage.status = 'up'
      } else {
        healthStatus.services.storage.status = 'down'
        healthStatus.services.storage.error = storageError?.message || 'Storage connection failed'
      }
    } catch (error) {
      healthStatus.services.storage.status = 'down'
      healthStatus.services.storage.error = error instanceof Error ? error.message : 'Unknown error'
    }

    // Get station advance activity from logs (approximate)
    try {
      const { data: stationState } = await supabaseAdmin
        .from('station_state')
        .select('updated_at')
        .single()
      
      if (stationState) {
        const lastUpdate = new Date(stationState.updated_at)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
        
        // This is a rough estimate - in production you'd want proper activity logging
        healthStatus.system.recent_activity.station_advances_last_hour = 
          lastUpdate > oneHourAgo ? 1 : 0
      }
    } catch (error) {
      // Non-critical, ignore
    }

    // Determine overall health status
    const services = Object.values(healthStatus.services)
    const downServices = services.filter(s => s.status === 'down').length
    
    if (downServices === 0) {
      healthStatus.status = 'healthy'
    } else if (downServices < services.length) {
      healthStatus.status = 'degraded'
    } else {
      healthStatus.status = 'unhealthy'
    }

    // Set appropriate HTTP status
    const httpStatus = healthStatus.status === 'healthy' ? 200 : 
                     healthStatus.status === 'degraded' ? 207 : 503

    res.status(httpStatus).json(healthStatus)

  } catch (error) {
    console.error('Health check error:', error)
    
    healthStatus.status = 'unhealthy'
    healthStatus.services.database.error = error instanceof Error ? error.message : 'Unknown error'
    
    res.status(503).json(healthStatus)
  }
}

export default secureHandler(healthHandler, securityConfigs.public)