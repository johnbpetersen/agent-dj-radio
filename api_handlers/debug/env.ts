// Dev-only endpoint to verify client env vars are accessible
// Helps catch deployment issues where VITE_* vars aren't properly injected

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  // Block in production
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' })
    return
  }

  // Return only VITE_* vars that client code relies on
  // This helps debug env injection issues in development
  const clientEnvs = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || '(not set)',
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY
      ? `${process.env.VITE_SUPABASE_ANON_KEY.substring(0, 20)}...` // Truncated for safety
      : '(not set)',
    VITE_AVATAR_CACHE_MAX_AGE_SEC: process.env.VITE_AVATAR_CACHE_MAX_AGE_SEC || '300 (default)',
  }

  res.status(200).json({
    message: 'Client environment variables (VITE_*)',
    note: 'This endpoint is only available in development',
    env: clientEnvs,
  })
}
