# Decisions (ADRs - lightweight)

## Core Architecture
- 2025-09-02: Keep Vite/Vercel/Supabase. No Next.js.
- 2025-09-02: Cron 1/min; idempotent handlers; UI polling + Realtime.
- 2025-09-02: Use native fetch and crypto.randomUUID (no axios/uuid).

## Payment System  
- 2025-09-02: x402 HTTP 402 payment challenges via Coinbase CDP; USDC on Base/Base-Sepolia (not Lightning).
- 2025-09-02: Feature flags as strings requiring exact match: `process.env.FLAG === 'true'`.

## Security (Sprint 6)
- 2025-09-02: Implement comprehensive Row Level Security (RLS) for all database tables with anonymous user support.
- 2025-09-02: Use security middleware wrapper for ALL API endpoints with configurable rate limiting.
- 2025-09-02: Strict CORS policy with explicit origin allowlisting (no wildcards in production).
- 2025-09-02: Automatic data sanitization to prevent sensitive field leakage to clients.
- 2025-09-02: In-memory rate limiting acceptable for MVP; Redis upgrade path documented.

## Monitoring & Operations (Sprint 7)
- 2025-09-02: Health monitoring at /api/health with service-level status checks.
- 2025-09-02: Admin panel includes health dashboard for real-time system visibility.
- 2025-09-02: Emergency recovery procedures documented and tested before production.
- 2025-09-02: Postmortem template required for all production incidents.

## Production Readiness
- 2025-09-02: Both feature flags (ENABLE_REAL_ELEVEN=true, ENABLE_X402=true) required for production.
- 2025-09-02: 85/100 minimum score required for production go-live decision.
- 2025-09-02: Concurrent testing with 5+ users required before production deployment.
- 2025-09-02: All admin recovery drills must be tested in staging before production.

## API Design
- 2025-09-02: All API endpoints return structured JSON with proper HTTP status codes.
- 2025-09-02: Error responses include correlation IDs for debugging but never expose internal details.
- 2025-09-02: Payment flow uses standard HTTP 402 "Payment Required" status code.
- 2025-09-02: Real-time updates via Supabase Realtime channels (not polling).