// Supabase database type definitions
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          display_name: string
          banned: boolean
          kind: 'human' | 'agent'
          created_at: string
          last_seen_at: string | null
        }
        Insert: {
          id?: string
          display_name: string
          banned?: boolean
          kind?: 'human' | 'agent'
          created_at?: string
          last_seen_at?: string | null
        }
        Update: {
          id?: string
          display_name?: string
          banned?: boolean
          kind?: 'human' | 'agent'
          created_at?: string
          last_seen_at?: string | null
        }
      }
      user_accounts: {
        Row: {
          id: string
          user_id: string
          provider: 'discord' | 'wallet'
          provider_user_id: string
          meta: Record<string, any>
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: 'discord' | 'wallet'
          provider_user_id: string
          meta?: Record<string, any>
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: 'discord' | 'wallet'
          provider_user_id?: string
          meta?: Record<string, any>
          created_at?: string
          updated_at?: string
        }
      }
      tracks: {
        Row: {
          id: string
          user_id: string
          prompt: string
          augmented_prompt: string | null
          duration_seconds: number
          source: 'GENERATED' | 'REPLAY'
          status: 'PENDING_PAYMENT' | 'PAID' | 'AUGMENTING' | 'QUEUED' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'
          price_usd: number
          x402_payment_tx: any | null
          eleven_request_id: string | null
          audio_url: string | null
          rating_score: number
          rating_count: number
          last_played_at: string | null
          submitter_user_id: string | null
          payer_user_id: string | null
          payment_confirmation_id: string | null
          created_at: string
          started_at: string | null
          finished_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          prompt: string
          augmented_prompt?: string | null
          duration_seconds?: number
          source: 'GENERATED' | 'REPLAY'
          status: 'PENDING_PAYMENT' | 'PAID' | 'AUGMENTING' | 'QUEUED' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'
          price_usd?: number
          x402_payment_tx?: any | null
          eleven_request_id?: string | null
          audio_url?: string | null
          rating_score?: number
          rating_count?: number
          last_played_at?: string | null
          submitter_user_id?: string | null
          payer_user_id?: string | null
          payment_confirmation_id?: string | null
          created_at?: string
          started_at?: string | null
          finished_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          prompt?: string
          augmented_prompt?: string | null
          duration_seconds?: number
          source?: 'GENERATED' | 'REPLAY'
          status?: 'PENDING_PAYMENT' | 'PAID' | 'AUGMENTING' | 'QUEUED' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'
          price_usd?: number
          x402_payment_tx?: any | null
          eleven_request_id?: string | null
          audio_url?: string | null
          rating_score?: number
          rating_count?: number
          last_played_at?: string | null
          submitter_user_id?: string | null
          payer_user_id?: string | null
          payment_confirmation_id?: string | null
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
      jobs: {
        Row: {
          id: string
          track_id: string
          kind: 'augment' | 'generate'
          status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout'
          attempts: number
          max_attempts: number
          external_ref: string | null
          error: Record<string, any> | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          track_id: string
          kind: 'augment' | 'generate'
          status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout'
          attempts?: number
          max_attempts?: number
          external_ref?: string | null
          error?: Record<string, any> | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          track_id?: string
          kind?: 'augment' | 'generate'
          status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout'
          attempts?: number
          max_attempts?: number
          external_ref?: string | null
          error?: Record<string, any> | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {}
    Functions: {
      merge_users_on_discord_link: {
        Args: {
          p_guest_user_id: string
          p_target_user_id: string
        }
        Returns: void
      }
      claim_next_job: {
        Args: {
          p_kind: 'augment' | 'generate'
        }
        Returns: Database['public']['Tables']['jobs']['Row'][]
      }
    }
    Enums: {
      track_source: 'GENERATED' | 'REPLAY'
      track_status: 'PENDING_PAYMENT' | 'PAID' | 'AUGMENTING' | 'QUEUED' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'
      reaction_kind: 'LOVE' | 'FIRE' | 'SKIP'
      user_kind: 'human' | 'agent'
      account_provider: 'discord' | 'wallet'
      job_kind: 'augment' | 'generate'
      job_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout'
    }
  }
}