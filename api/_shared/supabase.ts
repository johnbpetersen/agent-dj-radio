import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

let supabaseAdmin: any

// For local development without Supabase setup
if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn('⚠️  Using mock Supabase client for local development. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for real data.')
  
  // Create a mock client that returns sample data
  const mockClient = {
    from: (table: string) => ({
      select: (query: string) => ({
        eq: (column: string, value: any) => ({
          single: () => Promise.resolve({
            data: table === 'station_state' ? {
              id: 1,
              current_track_id: 'mock-track-1',
              current_started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              current_track: {
                id: 'mock-track-1',
                user_id: 'mock-user',
                prompt: 'A chill lo-fi beat for coding',
                duration_seconds: 180,
                status: 'PLAYING',
                audio_url: 'https://example.com/mock-audio.mp3',
                created_at: new Date().toISOString()
              }
            } : null,
            error: null
          }),
          limit: (count: number) => Promise.resolve({
            data: [],
            error: null
          })
        }),
        in: (column: string, values: any[]) => ({
          order: (orderBy: string, options?: any) => Promise.resolve({
            data: table === 'tracks' ? [
              {
                id: 'mock-track-2',
                user_id: 'mock-user-2',
                prompt: 'Upbeat electronic dance music',
                duration_seconds: 200,
                status: 'READY',
                audio_url: 'https://example.com/mock-audio-2.mp3',
                created_at: new Date(Date.now() - 60000).toISOString(),
                user: {
                  id: 'mock-user-2',
                  username: 'dj_mock'
                }
              }
            ] : [],
            error: null
          })
        })
      })
    })
  }
  
  supabaseAdmin = mockClient
} else {
  // Service role client for API endpoints (bypasses RLS)
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)
}

export { supabaseAdmin }
export default supabaseAdmin