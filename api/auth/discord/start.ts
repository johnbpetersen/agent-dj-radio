// Serverless function shim for /api/auth/discord/start
// Re-exports handler from shared handlers directory
// This ensures Vercel routes directly to this function (bypasses catch-all)
// Initiates Discord OAuth flow with dynamic redirect_uri

export { default } from '../../../api_handlers/auth/discord/start.js'
