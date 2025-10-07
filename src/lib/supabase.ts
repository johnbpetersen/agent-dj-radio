import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { clientEnv } from '../config/env.client'

// Anonymous client for frontend use
export const supabase = createClient<Database>(
  clientEnv.VITE_SUPABASE_URL,
  clientEnv.VITE_SUPABASE_ANON_KEY
)

export default supabase