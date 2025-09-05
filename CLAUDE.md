# CLAUDE OPERATING MANUAL

## Project Status: LOCAL DEV COMPLETE 🚀
**Current Phase:** Production Deployment & User Testing  
**Local Development:** ✅ COMPLETE (Real Supabase integration working)
**Sprint Status:** Completed local dev improvements - Ready for production deployment  
**Go/No-Go Decision:** 🟢 **GO** (85/100 production readiness score)

## Mode
- Act as a **coding agent** for this repo. Stack: Vite + React + TS, Vercel Functions, Supabase.
- **Do not** introduce Next.js or large libs without approval.
- **PRODUCTION-READY**: All security, monitoring, and operational procedures in place.

## Ground Rules
1) Before coding: **list** (a) files to add/modify, (b) tests to add/update, (c) risks. Then **WAIT** for "Proceed".
2) When coding: output **FULL file contents**, not diffs.
3) Prefer **native** Node APIs (fetch, crypto.randomUUID). Avoid axios/uuid unless justified.
4) Feature flags are strings: `process.env.FLAG === 'true'`.
5) Cron expectations: handlers are **idempotent**; cron runs **~1/min**; UI uses polling + Realtime.
6) Realtime via `supabase-js` channels only.
7) Server recomputes price; never trusts client amounts (x402 HTTP 402 payment challenges).
8) Keep mock paths working when flags are false.

## Security Requirements (ENFORCED)
- **ALL** new API endpoints MUST use `secureHandler()` wrapper from `api/_shared/secure-handler.ts`
- **ALL** client responses MUST use `sanitizeForClient()` to remove sensitive fields
- **NO** sensitive data (API keys, tokens, internal IDs) in client responses
- Rate limiting enforced on all endpoints
- CORS origins must be explicitly allowlisted

## Production Deployment
- Environment variables REQUIRED for production:
  ```bash
  ENABLE_REAL_ELEVEN=true
  ENABLE_X402=true
  ENABLE_REQUEST_LOGGING=true
  ENABLE_ERROR_TRACKING=true
  ```
- Health monitoring MUST show all green before deployment
- Admin recovery drills MUST be tested in staging
- Postmortem template ready for any incidents

## Local Development Setup (UPDATED 2025-09-05)
**NEW**: No Vercel CLI required for development!
- **Start Dev**: `npm run dev` (starts both API server and frontend)
- **Architecture**: 
  - Port 3001: Local functions server (`dev-functions-server.ts`) serving real `./api/*.ts` files
  - Port 5173: Vite frontend proxying `/api/*` to port 3001
  - Real Supabase database integration (no mock data confusion)
  - Automatic station bootstrapping (first track → PLAYING, others → READY queue)

## Testing Requirements  
- TypeScript compilation: `npm run typecheck`
- Security audit: Check no secrets leak to client
- Concurrent testing: `node test-concurrent-submissions.js`
- Health check: `/api/health` must return status 200
- Admin functionality: `/?admin=1` must be accessible
- **Verification**: `curl -s http://localhost:3001/api/station/state` should show real tracks from Supabase

## Monitoring & Operations
- Health dashboard: `/api/health` and admin panel integration
- Recovery procedures: `ADMIN_RECOVERY_DRILLS.md`
- Incident response: `POSTMORTEM_TEMPLATE.md`
- Operational runbook: `RUNBOOK.md`

## Commit Discipline
- Use **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- One logical change per commit; include a short rationale in body if non-trivial.

## Development Troubleshooting (ADDED 2025-09-05)
**Common Issues**:
- **Port 5173 shows fake/mock data**: Check Vite proxy points to port 3001, not mock server
- **Empty queue**: Database may be empty; check tracks have `audio_url` and valid status
- **"SUPABASE_URL not found"**: Ensure `.env.local` exists with correct credentials
- **ESM import errors**: In dev, use bare imports (`'../shared/supabase'`); in production, add `.js` extension

## When Unsure  
- Ask targeted questions with 1–3 options. Avoid refactors unless requested.
- Consult `PRODUCTION_GO_NO_GO_REPORT.md` for production readiness criteria
- Use `curl -s http://localhost:3001/api/station/state` to verify real data integration

## Stop Conditions
- Any failing tests or type errors → STOP and show failing output.
- Any API key/secrets in output → STOP and redact.
- Security vulnerabilities detected → STOP and remediate.
- Health checks failing → STOP and investigate.
- **Local dev showing mock data** → STOP and fix proxy/server configuration.