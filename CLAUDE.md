# CLAUDE.md — Working Agreement & Guardrails

You are Claude Code working on this repo. Follow these rules on every task:

## Workflow
- **Plan-first**: Your first reply is a plan (files, tests, schema, risks). **Wait for `/approve`** before coding.
- **TDD**: Write failing tests first, then code to make them pass.
- **Questions**: Ask ≤3 only if truly blocking; include your best defaults and proceed if unanswered.
- **Scope**: Touch only files you list in your plan. No drive-by refactors or dep bumps.
- **Output**: When coding, return **full file contents**, not diffs.

## Repo Conventions
- **ESM**: Use `.js` suffix on all relative imports.
- **Handlers**: Wrap APIs with `secureHandler()` from `api/_shared/secure-handler.ts`.
- **Sanitization**: Use `sanitizeForClient()` on responses when applicable.
- **Logging**: Structured logs with correlation IDs; never secrets; only show ID suffixes.
- **Env**: No hardcoded secrets. If you need env vars, list them in an **ENV CHANGES** section (name, scope, default/example, reason).

## Current Sprint (Simple Identity)
- **No Discord** anywhere—do not reintroduce it.
- **Sessions are the source of identity**. Presence TTL must not gate identity.
- Default = **guest/ephemeral** user with a long-lived session cookie.
- Future steps may add **wallet link/unlink** to flip ephemeral ↔ persistent, but do **not** skip ahead.

## Definition of Done (each step)
- Tests pass (unit/integration per your plan).
- Typecheck & build pass; no console spam.
- Structured logs on error paths.
- Smoke script demonstrates the feature.
- ENV CHANGES are explicitly documented, or “none”.