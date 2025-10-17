You are operating on branch: <branch-name>

Objective (this step only):
<1–2 sentences>

Context:
- Relevant modules/routes/tables:
  - <list only what matters>
- Constraints: sessions are source of identity; no Discord; ESM .js

Scope & Constraints:
- In-scope:
  - <tight bullets>
- Out-of-scope:
  - <tight bullets>
- Security/Privacy: no PII in logs; id suffix only
- Perf/Cost: keep simple
- Migrations: <if any + rollback note>

Deliverables (TDD):
- Tests FIRST (show failing → code → passing)
- Minimal code to satisfy tests
- Smoke script (bash + curl) with expected outputs
- **ENV CHANGES**: (name, scope dev/preview/prod, default/example, reason) OR “none”

Interfaces & Contracts:
- Routes:
- Request/Response shapes:
- Cookies/Headers:
- DB schema touched:

Acceptance Criteria:
- [ ] New tests green
- [ ] Typecheck & build pass
- [ ] Smoke script passes
- [ ] No out-of-scope files changed
- [ ] ENV CHANGES section present

Risks & Rollback:
- Risks:
- Rollback: revert commits
- Manual fallback:

Your FIRST reply (before coding):
1) Plan of attack (steps, functions, tests)
2) Files to touch/create/delete
3) Edge cases handled
4) Clarifying questions (≤3) with your best defaults

Wait for /approve before coding.