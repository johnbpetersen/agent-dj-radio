import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

let supabaseAdmin: any

// Require real Supabase credentials - no mock fallback
if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing required Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Check your .env file.')
}

// Service role client for API endpoints (bypasses RLS)
supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

export { supabaseAdmin }
export default supabaseAdmin