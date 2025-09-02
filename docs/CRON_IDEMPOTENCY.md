# Cron Job Idempotency Guarantees

This document outlines how Agent DJ Radio's cron jobs maintain idempotent behavior to ensure reliable operation even with concurrent executions or failures.

## Overview

Both cron jobs run **every minute** (`*/1 * * * *`) and are designed to be **idempotent**, meaning:
- Multiple executions produce the same result as a single execution
- Safe to run concurrently without corruption
- Failed executions can be retried without side effects
- State transitions are atomic and consistent

## Worker Generate Job (`/api/worker/generate`)

### Idempotency Mechanisms

**1. Atomic Track Claiming:**
```sql
-- Uses PostgreSQL FOR UPDATE SKIP LOCKED
SELECT * FROM tracks 
WHERE status = 'PAID' 
ORDER BY created_at ASC 
LIMIT 1 
FOR UPDATE SKIP LOCKED
```
- Only one worker can claim a PAID track at a time
- Concurrent executions skip locked rows automatically
- No double-processing of the same track

**2. Status Transitions:**
- `PAID` → `GENERATING` → `READY` (success path)
- `PAID` → `GENERATING` → `FAILED` (failure path)
- Each transition is atomic via single database update
- Duplicate status updates are safely ignored

**3. External Service Calls:**
- ElevenLabs generation is idempotent by design
- Failed generations mark track as `FAILED` (terminal state)
- Storage uploads use unique track IDs (no overwrites)

**4. No-op Behavior:**
- Returns `processed: false` when no PAID tracks exist
- Safe to call multiple times with no side effects

### Verification Tests

```bash
# Test concurrent execution safety
curl -X POST /api/worker/generate & curl -X POST /api/worker/generate
# Both should succeed, only one should process any given track

# Test repeated calls with no tracks
curl -X POST /api/worker/generate
# Should consistently return "No tracks to generate"
```

## Station Advance Job (`/api/station/advance`)

### Idempotency Mechanisms

**1. Track Completion Check:**
```typescript
if (currentTrack && !isTrackFinished(currentTrack, playheadSeconds)) {
  return { advanced: false, message: 'Current track still playing' }
}
```
- Only advances when current track is actually finished
- Playhead calculation is deterministic based on start time
- Multiple calls while track playing return consistent response

**2. State Transitions:**
- `PLAYING` → `DONE` (current track completion)
- `READY` → `PLAYING` (next track selection)
- Station state updates are atomic (single row, ID=1)

**3. Track Selection:**
- Deterministic algorithm: READY tracks (FIFO) → Best DONE tracks (rating + time)
- Multiple executions select the same "next" track
- Replay creation is consistent based on rating scores

**4. Broadcast Operations:**
- Supabase Realtime broadcasts are idempotent
- Multiple identical broadcasts don't cause issues
- Client-side deduplication handles overlapping updates

### Edge Cases Handled

**Empty Queue:**
- Safely clears station state (`current_track_id: null`)
- Returns consistent "no tracks available" message
- Multiple calls maintain cleared state

**Concurrent Advances:**
- Database constraints prevent invalid states
- Only one track can have `status = 'PLAYING'` at a time
- Station table has single row with atomic updates

**Replay Generation:**
- Creates new tracks with `source = 'REPLAY'`
- Based on deterministic "best track" selection
- Safe to generate multiple replays of popular tracks

### Verification Tests

```bash
# Test with track still playing
curl -X POST /api/station/advance
# Should return "still playing" consistently until track finishes

# Test empty queue handling
curl -X POST /api/station/advance
# Should clear station and return "no tracks" consistently

# Test concurrent execution
curl -X POST /api/station/advance & curl -X POST /api/station/advance
# Both should succeed, station should advance exactly once
```

## Database Constraints Supporting Idempotency

### Track Status Constraints
```sql
CREATE TYPE track_status AS ENUM (
  'PENDING_PAYMENT', 'PAID', 'GENERATING', 
  'READY', 'PLAYING', 'DONE', 'FAILED', 'ARCHIVED'
);
```

### Station State Constraints
```sql
CREATE TABLE station_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  current_track_id UUID REFERENCES tracks(id),
  current_started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_station CHECK (id = 1)
);
```

### Concurrency Control
```sql
-- Claiming tracks (in claimNextPaidTrack function)
UPDATE tracks 
SET status = 'claimed_for_generation'
WHERE id = (
  SELECT id FROM tracks 
  WHERE status = 'PAID' 
  ORDER BY created_at ASC 
  LIMIT 1 
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

## Monitoring Idempotency

### Structured Logging
Each cron execution logs:
- `cronJobStart` - Job initiation with correlation ID
- `cronJobComplete` - Job completion with duration and result
- All state transitions with before/after status
- Error conditions with full context

### Key Metrics to Monitor
- **Duplicate Processing**: Should be zero (same track processed twice)
- **State Corruption**: Should be zero (invalid status transitions)
- **Execution Time**: Should be consistent (< 10s for most operations)
- **Success Rate**: Should be > 99% (excluding external service failures)

### Alert Conditions
- Track stuck in `GENERATING` for > 10 minutes
- Multiple tracks with `status = 'PLAYING'` simultaneously
- Station advance frequency > 2x expected (indicates timing issues)
- Worker generate frequency > expected track volume

## Testing Idempotency

### Unit Tests
```typescript
// Verify no-op behavior
test('worker returns no-op when no PAID tracks', async () => {
  const result1 = await callWorker()
  const result2 = await callWorker()
  expect(result1).toEqual(result2)
  expect(result1.processed).toBe(false)
})

// Verify concurrent safety
test('concurrent workers process different tracks', async () => {
  // Create 2 PAID tracks
  const [result1, result2] = await Promise.all([
    callWorker(),
    callWorker()
  ])
  
  expect(result1.track.id).not.toBe(result2.track.id)
  expect([result1.processed, result2.processed]).toEqual([true, true])
})
```

### Integration Tests
Run against staging environment with real timing:
```bash
# Rapid-fire cron simulation
for i in {1..10}; do
  curl -X POST https://staging.agent-dj-radio.vercel.app/api/worker/generate &
done
wait

# Verify no duplicate processing occurred
curl https://staging.agent-dj-radio.vercel.app/api/admin/state
# Check that only expected number of tracks were processed
```

## Failure Recovery

### Partial Failures
- Track stuck in `GENERATING`: Admin can requeue → `READY` 
- Station state corrupted: Admin can force advance
- External service timeout: Track marked `FAILED`, others continue

### Complete Failures
- Vercel function timeout: Next cron execution continues from last known state
- Database connectivity: Function fails fast, next execution retries
- Supabase storage issues: Track marked `FAILED`, system continues

---

**Conclusion:** Both cron jobs are designed to be safely executed at high frequency with guaranteed idempotent behavior. The combination of database constraints, atomic operations, and deterministic algorithms ensures system consistency even under failure conditions.