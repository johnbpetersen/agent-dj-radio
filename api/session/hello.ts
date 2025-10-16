// Serverless function shim for /api/session/hello
// Re-exports handler from shared handlers directory
// This ensures Vercel routes directly to this function (bypasses catch-all)
// Supports both GET and POST methods (idempotent cookie-based session init)

export { default } from '../../api_handlers/session/hello.js'
