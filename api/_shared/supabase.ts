// api/_shared/supabase.ts
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '../../src/config/env.js'

// Service-role client for API routes (bypasses RLS)
const supabaseAdmin = createClient(
  serverEnv.SUPABASE_URL,
  serverEnv.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
)

export default supabaseAdmin
export { supabaseAdmin }