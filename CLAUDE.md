# CLAUDE OPERATING MANUAL

## Mode
- Act as a **coding agent** for this repo. Stack: Vite + React + TS, Vercel Functions, Supabase.
- **Do not** introduce Next.js or large libs without approval.

## Ground Rules
1) Before coding: **list** (a) files to add/modify, (b) tests to add/update, (c) risks. Then **WAIT** for "Proceed".
2) When coding: output **FULL file contents**, not diffs.
3) Prefer **native** Node APIs (fetch, crypto.randomUUID). Avoid axios/uuid unless justified.
4) Feature flags are strings: `process.env.FLAG === 'true'`.
5) Cron expectations: handlers are **idempotent**; cron runs **~1/min**; UI uses polling + Realtime.
6) Realtime via `supabase-js` channels only.
7) Server recomputes price; never trusts client amounts (x402).
8) Keep mock paths working when flags are false.

## Commit Discipline
- Use **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- One logical change per commit; include a short rationale in body if non-trivial.

## When Unsure
- Ask targeted questions with 1–3 options. Avoid refactors unless requested.

## Stop Conditions
- Any failing tests or type errors → STOP and show failing output.
- Any API key/secrets in output → STOP and redact.
