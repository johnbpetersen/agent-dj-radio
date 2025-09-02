# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic Versioning].

## [Unreleased]
### Added
- Next phase: Live testing with real API keys and user validation
### Changed
- N/A
### Fixed
- N/A

## [2025-09-02] - Sprint 7: Staging Beta Rehearsal
### Added
- feat(health): Comprehensive health monitoring dashboard at /api/health
- feat(health): Real-time system status tracking (database, ElevenLabs, storage)
- feat(health): Feature flag visibility and queue statistics
- feat(admin): Health dashboard integrated into admin panel with auto-refresh
- test(concurrent): Concurrent submission testing script for load validation
- docs(operations): Admin recovery drill procedures for 6 common incident types
- docs(operations): Professional postmortem template for incident analysis
- docs(production): Comprehensive go/no-go report with 85/100 readiness score
- docs(deployment): Sprint 7 staging setup guide with environment configuration

### Changed
- feat(production): Production-ready feature flag configuration guidance
- ops(monitoring): Health checks with auto-refresh every 30 seconds
- ops(recovery): Emergency procedures for station, generation, payment, and database issues

### Security
- All systems verified production-ready with comprehensive monitoring
- Recovery procedures tested and documented
- Incident response framework established

## [2025-09-02] - Sprint 6: Security Hardening
### Added
- feat(security): Comprehensive Row Level Security (RLS) policies for all tables
- feat(security): Anonymous user support with proper access controls  
- feat(security): CORS lockdown with strict origin validation
- feat(security): Comprehensive security headers including CSP
- feat(security): Per-IP rate limiting with configurable limits per endpoint type
- feat(security): Automatic data sanitization removing sensitive fields from client responses
- feat(legal): Privacy policy endpoint at /api/legal/privacy with comprehensive coverage
- feat(legal): Terms of service endpoint at /api/legal/terms with blockchain payment terms
- feat(middleware): Security middleware wrapper for all API endpoints
- docs(security): Complete operations runbook with security procedures
- docs(security): Secret rotation procedures and security monitoring guidelines

### Changed
- BREAKING: All API endpoints now use secure handler middleware
- BREAKING: Sensitive fields automatically removed from all client responses
- security: Rate limiting enforced on all endpoints (100/min public, 30/min user, 60/min admin)
- security: CORS origins must be explicitly configured in ALLOWED_ORIGINS

### Security
- fix(security): Eliminated sensitive data leakage in track objects (eleven_request_id, x402_payment_tx)
- security: Implemented comprehensive security audit with data sanitization
- security: All endpoints protected with rate limiting and CORS validation
- security: Database access secured with RLS policies

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