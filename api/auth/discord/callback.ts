// Thin shim so Vercel has an exact function for the Discord callback.
// Keeps all real logic in api_handlers (single source of truth).
export { default } from '../../../api_handlers/auth/discord/callback.js'