# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic Versioning].

## [Unreleased]
### Added
- Sprint 2 integrations (ElevenLabs, x402) behind flags.
- feat(admin): API endpoints + tests for manual station control
### Changed
- Repo hygiene and docs for LLM collaboration.
### Fixed
- N/A

## [2025-09-02]
### Added
- feat(admin): Secure admin API endpoints with token-based authentication
- feat(admin): Manual track generation trigger via /api/admin/generate
- feat(admin): Manual station advance via /api/admin/advance
- feat(admin): Admin state monitoring via /api/admin/state
- feat(admin): Track operations (skip/requeue/delete) via /api/admin/track/:id
- test(admin): Comprehensive test suite for all admin endpoints covering auth, happy paths, and edge cases
- docs(admin): Admin Controls section in README.md with curl examples
- docs(admin): RUNBOOK.md with emergency procedures and operational guidance

### Changed
- docs: align env vars, x402 wording, quick-start
- Updated all documentation to match actual codebase usage
- Fixed environment variable names (SUPABASE_SERVICE_ROLE_KEY vs SUPABASE_SERVICE_ROLE)
- Corrected x402 references from Lightning to HTTP 402 payment challenges via Coinbase CDP
- Clarified development setup requires two terminals (Vercel + Vite)
- Added proper frontend/backend environment variable separation

### Security
- Admin endpoints return 404 when ADMIN_TOKEN not configured (security by obscurity)
- Bearer token authentication required for all admin operations
- No admin functionality exposed in public UI

[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html