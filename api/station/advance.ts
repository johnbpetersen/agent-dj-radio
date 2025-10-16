// Serverless function shim for /api/station/advance
// Re-exports handler from shared handlers directory
// This ensures Vercel routes directly to this function (bypasses catch-all)
// Supports both GET and POST methods (idempotent operation)

export { default } from '../../api_handlers/station/advance.js'
