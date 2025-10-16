// Serverless function shim for /api/station/state
// Re-exports handler from shared handlers directory
// This ensures Vercel routes directly to this function (bypasses catch-all)

export { default } from '../../api_handlers/station/state.js'
