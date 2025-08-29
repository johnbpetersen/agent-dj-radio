// Supabase database type definitions
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          display_name: string
          banned: boolean
          created_at: string
        }
        Insert: {
          id?: string
          display_name: string
          banned?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          banned?: boolean
          created_at?: string
        }
      }
      tracks: {
        Row: {
          id: string
          user_id: string
          prompt: string
          duration_seconds: number
          source: 'GENERATED' | 'REPLAY'
          status: 'PAID' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'
          price_usd: number
          x402_payment_tx: any | null
          eleven_request_id: string | null
          audio_url: string | null
          rating_score: number
          rating_count: number
          last_played_at: string | null
          created_at: string
          started_at: string | null
          finished_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          prompt: string
          duration_seconds?: number
          source: 'GENERATED' | 'REPLAY'
          status: 'PAID' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'
          price_usd?: number
          x402_payment_tx?: any | null
          eleven_request_id?: string | null
          audio_url?: string | null
          rating_score?: number
          rating_count?: number
          last_played_at?: string | null
          created_at?: string
          started_at?: string | null
          finished_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          prompt?: string
          duration_seconds?: number
          source?: 'GENERATED' | 'REPLAY'
          status?: 'PAID' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'
          price_usd?: number
          x402_payment_tx?: any | null
          eleven_request_id?: string | null
          audio_url?: string | null
          rating_score?: number
          rating_count?: number
          last_played_at?: string | null
          created_at?: string
          started_at?: string | null
          finished_at?: string | null
        }
      }
      reactions: {
        Row: {
          id: string
          track_id: string
          user_id: string
          kind: 'LOVE' | 'FIRE' | 'SKIP'
          created_at: string
        }
        Insert: {
          id?: string
          track_id: string
          user_id: string
          kind: 'LOVE' | 'FIRE' | 'SKIP'
          created_at?: string
        }
        Update: {
          id?: string
          track_id?: string
          user_id?: string
          kind?: 'LOVE' | 'FIRE' | 'SKIP'
          created_at?: string
        }
      }
      station_state: {
        Row: {
          id: number
          current_track_id: string | null
          current_started_at: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          current_track_id?: string | null
          current_started_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          current_track_id?: string | null
          current_started_at?: string | null
          updated_at?: string
        }
      }
    }
    Views: {}
    Functions: {}
    Enums: {
      track_source: 'GENERATED' | 'REPLAY'
      track_status: 'PAID' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'
      reaction_kind: 'LOVE' | 'FIRE' | 'SKIP'
    }
  }
}