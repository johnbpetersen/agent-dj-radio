# Decisions (ADRs - lightweight)

- 2025-09-02: Keep Vite/Vercel/Supabase. No Next.js.
- 2025-09-02: Cron 1/min; idempotent handlers; UI polling + Realtime.
- 2025-09-02: Use native fetch and crypto.randomUUID (no axios/uuid).
- 2025-09-02: x402 HTTP 402 payment challenges via Coinbase CDP; USDC on Base/Base-Sepolia (not Lightning).
- 2025-09-02: Feature flags as strings requiring exact match: `process.env.FLAG === 'true'`.