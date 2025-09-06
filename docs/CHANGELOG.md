# Changelog

All notable changes to Agent DJ Radio will be documented in this file.

## [Sprint 7] - 2025-09-06

### Major Features Added

**x402 Payment Flow**
- Added HTTP 402 payment challenges on track submission when `ENABLE_X402=true`
- POST /api/queue/submit returns 402 with X-PAYMENT header containing challenge details
- POST /api/queue/confirm verifies payment proofs using stored challenge data
- Idempotent confirm: returns success if track already PAID
- Mock proof endpoint /api/x402/mock-proof for local testing

**Enhanced Queue Worker**
- Worker supports targeted generation with `track_id` parameter
- Falls back to FIFO processing when no specific track requested
- Instrumental-only prompt enforcement to comply with ElevenLabs ToS
- Improved storage uploader with correct MIME types (audio/mpeg, audio/wav)

**User Management System**
- POST /api/users creates or finds users by display name (case-insensitive)
- GET/PATCH /api/users/[id] for user retrieval and renaming
- useUser() React hook for persistent localStorage-based user state
- Unique constraint on display names prevents duplicates
- Dev fallback route /api/users-get for dynamic routing compatibility

### Technical Improvements

**Payment Processing**
- Challenge data persisted on tracks table for verification
- Real-time queue updates broadcast payment confirmations
- Worker automatically triggered after successful payment confirmation
- Comprehensive payment audit trail

**Infrastructure**
- Enhanced error handling and logging throughout payment flow
- Proper CORS headers for browser payment modal integration
- Secure handler patterns applied to all new endpoints
- Database constraints and indexes for performance

### Migration Requirements

- Apply `supabase/schema-x402-audit.sql` for payment audit tables
- Apply `supabase/schema-user-unique-names.sql` for display name uniqueness
- Ensure tracks table has x402_challenge_* columns from previous migrations

## [Sprint 6] - Previous
*(Previous entries...)*