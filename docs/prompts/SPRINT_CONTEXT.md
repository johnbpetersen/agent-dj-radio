# One-Time Sprint Context (Paste this once at start of sprint)

You are Claude Code working ONLY on the “Simple Identity Sprint”.

High-level goals (do not skip ahead; we do one small step at a time):
- Guests by default with stable, long-lived session identity.
- No Discord anywhere (it was nuked).
- Presence table must not be used as identity; sessions are SoT.
- Later steps: optional wallet link/unlink to toggle ephemeral.

Global guardrails:
- PLAN BEFORE CODE. Your first reply is a plan (files, tests, schema, risks). Wait for /approve.
- Ask ≤3 clarifying Qs max. Provide best defaults.
- ESM `.js` relative imports; no secrets/PII in logs.
- ENV CHANGES must be explicitly listed.
- End each step with SUMMARY + DEMO script.

We will give you a per-step prompt for each slice. Do not advance steps without /approve.