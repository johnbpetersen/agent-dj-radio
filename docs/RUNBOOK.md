# Agent DJ Radio - Operations Runbook

This guide covers admin operations for production and staging deployments.

## Admin Token Setup

### Setting Admin Token

**Staging/Production (Vercel Dashboard):**
1. Go to Vercel project → Settings → Environment Variables
2. Add `ADMIN_TOKEN` with a secure random value (32+ characters)
3. Redeploy to activate admin endpoints

**Local Development:**
```bash
# In .env.local
ADMIN_TOKEN=your-secure-admin-token-here
```

**Generate Secure Token:**
```bash
# Option 1: OpenSSL
openssl rand -base64 32

# Option 2: Node.js
node -e "console.log(crypto.randomBytes(32).toString('base64'))"
```

### Security Notes
- Never commit admin tokens to git
- Use different tokens for staging vs production
- Admin endpoints return 404 when `ADMIN_TOKEN` not set
- Rotate tokens periodically for security

## Emergency Procedures

### Quick Reference Commands

All commands assume you have the admin token. Replace `$ADMIN_TOKEN` with your actual token.

```bash
# Base URL for your deployment
BASE_URL="https://your-app.vercel.app"  # Production
# BASE_URL="http://localhost:3000"      # Local dev

# Headers for all admin commands
AUTH_HEADER="Authorization: Bearer $ADMIN_TOKEN"
```

### 1. Station Stuck / Not Playing

**Symptoms:** Station shows a track but it's not advancing, users report silence

**Diagnosis:**
```bash
# Check current station state
curl "$BASE_URL/api/admin/state" \
  -H "$AUTH_HEADER"
```

**Fix:**
```bash
# Force advance to next track
curl -X POST "$BASE_URL/api/admin/advance" \
  -H "$AUTH_HEADER"
```

### 2. Track Generation Stalled

**Symptoms:** Tracks stuck in PAID status, queue not processing

**Diagnosis:**
```bash
# Check for PAID tracks in queue
curl "$BASE_URL/api/admin/state" \
  -H "$AUTH_HEADER" \
  | jq '.queue[] | select(.status == "PAID")'
```

**Fix:**
```bash
# Manually trigger generation
curl -X POST "$BASE_URL/api/admin/generate" \
  -H "$AUTH_HEADER"
```

### 3. Bad Track Playing

**Symptoms:** Current track is inappropriate, broken, or needs immediate removal

**Get Current Track ID:**
```bash
curl "$BASE_URL/api/admin/state" \
  -H "$AUTH_HEADER" \
  | jq '.station_state.current_track.id'
```

**Skip Current Track:**
```bash
curl -X POST "$BASE_URL/api/admin/track/TRACK_ID" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"action": "skip"}'
```

**Delete Bad Track (Nuclear Option):**
```bash
curl -X DELETE "$BASE_URL/api/admin/track/TRACK_ID" \
  -H "$AUTH_HEADER"
```

### 4. Queue Empty / No Content

**Symptoms:** No tracks in queue, users can't hear anything

**Check Queue:**
```bash
curl "$BASE_URL/api/admin/state" \
  -H "$AUTH_HEADER" \
  | jq '.queue | length'
```

**Requeue Recent Popular Tracks:**
```bash
# Get recent DONE tracks (high rating)
curl "$BASE_URL/api/admin/state" \
  -H "$AUTH_HEADER" \
  | jq '.recent_tracks[] | select(.rating_score > 1) | .id'

# Requeue a specific track
curl -X POST "$BASE_URL/api/admin/track/TRACK_ID" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"action": "requeue"}'
```

## Feature Flag Management

### Current Flags
```bash
# In Vercel environment variables
ENABLE_REAL_ELEVEN=false    # Enable ElevenLabs generation
ENABLE_X402=false           # Enable x402 payments
```

### Safe Rollout Sequence

**Stage 1 - Staging Only:**
```bash
ENABLE_REAL_ELEVEN=true     # Test real music generation
ENABLE_X402=false           # Keep payments off
```

**Stage 2 - Production Music:**
```bash
ENABLE_REAL_ELEVEN=true     # Enable music in prod
ENABLE_X402=false           # Keep payments off
```

**Stage 3 - Full Production:**
```bash
ENABLE_REAL_ELEVEN=true     # Music enabled
ENABLE_X402=true            # Payments enabled
```

### Rollback Procedures

**Emergency Rollback to Mock Mode:**
1. Vercel Dashboard → Environment Variables
2. Set `ENABLE_REAL_ELEVEN=false`
3. Set `ENABLE_X402=false`
4. Redeploy
5. Verify mock generation works

**Partial Rollback (Keep Music, Disable Payments):**
1. Set `ENABLE_X402=false`
2. Keep `ENABLE_REAL_ELEVEN=true`
3. Redeploy

## Monitoring & Health Checks

### Structured Logging

All API requests and cron jobs include correlation IDs for tracking:

```bash
# Example log entry
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "level": "info",
  "message": "API request completed",
  "correlationId": "req_abc123def456",
  "method": "POST",
  "path": "/api/queue/submit",
  "statusCode": 201,
  "duration": 245,
  "userId": "user_789"
}
```

**Finding Logs by Correlation ID:**
```bash
# In Vercel logs, search for specific request
vercel logs --follow | grep "req_abc123def456"

# Track complete request lifecycle
vercel logs --follow | grep "correlationId.*abc123def456"
```

### Error Tracking

Errors are automatically tracked with context:

```bash
# Example error log
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "level": "error",
  "message": "ElevenLabs generation failed",
  "correlationId": "cron_def456ghi789",
  "error": {
    "name": "APIError",
    "message": "Rate limit exceeded",
    "stack": "..."
  },
  "context": {
    "trackId": "track_123",
    "prompt": "happy upbeat song",
    "duration": 60
  }
}
```

**Error Analysis Commands:**
```bash
# Find all errors in the last hour
vercel logs --since 1h | grep '"level":"error"'

# Track errors for specific track
vercel logs --follow | grep "trackId.*track_123"

# Monitor generation failures
vercel logs --follow | grep "ElevenLabs generation failed"
```

### Health Monitoring Endpoints

**Basic Health Check:**
```bash
# Public station state (always available)
curl "$BASE_URL/api/station/state"

# Expected response time: < 500ms
# Should return current track and queue
```

**Admin Health Check:**
```bash
# Admin state with full diagnostics (requires auth)
curl "$BASE_URL/api/admin/state" -H "$AUTH_HEADER"

# Returns: station_state, queue, recent_tracks, system_health
# Expected response time: < 1000ms
```

### Automated Health Monitoring

**Cron Job Health:**
```bash
# Monitor cron execution in logs
vercel logs --follow | grep "cronJobStart\|cronJobEnd"

# Look for patterns like:
# "cronJobStart": {"name": "worker/generate", "correlationId": "cron_123"}
# "cronJobEnd": {"name": "worker/generate", "correlationId": "cron_123", "duration": 2341}
```

**Performance Baselines:**
- Generate worker: < 10 seconds per track
- Station advance: < 2 seconds
- API responses: < 1 second
- Database queries: < 500ms

### Smoke Test Checklist

After deployments, verify:

```bash
# 1. Station state accessible
curl "$BASE_URL/api/station/state" | jq '.station_state'

# 2. Admin endpoints secured (should return 401 without token)
curl "$BASE_URL/api/admin/state"

# 3. Admin token works
curl "$BASE_URL/api/admin/state" -H "$AUTH_HEADER" | jq '.'

# 4. Queue processing (check correlation ID in response)
curl -X POST "$BASE_URL/api/admin/generate" -H "$AUTH_HEADER"

# 5. Station advancing (check correlation ID in response)
curl -X POST "$BASE_URL/api/admin/advance" -H "$AUTH_HEADER"

# 6. Error tracking works (check logs for correlation IDs)
vercel logs --follow | head -10
```

### Key Metrics to Watch

**Queue Health:**
- PAID tracks should process within 5 minutes
- READY tracks should exist when users submit  
- No tracks stuck in GENERATING for >10 minutes
- Generation success rate > 90%

**Station Health:**
- Playhead should advance consistently
- Track transitions should happen automatically
- No gaps in playback during normal operation
- Station advance operations complete in < 2 seconds

**API Health:**
- Response times within baselines
- Error rate < 5%
- All requests have correlation IDs
- Cron jobs complete within expected time

**Error Indicators:**
- Multiple FAILED tracks in a row
- Station state with null current_track for >5 minutes
- Admin endpoints returning 500 errors
- Missing correlation IDs in logs (indicates system issues)
- High error tracking volume

## Troubleshooting Common Issues

### Monitoring and Logging Issues

**Missing Correlation IDs:**

*Symptoms:* Logs missing correlation IDs, hard to track requests

*Diagnosis:*
```bash
# Check if logger is working
vercel logs --follow | grep "correlationId"

# Should see entries like: "correlationId": "req_..." or "cron_..."
```

*Solutions:*
- Verify structured logging is enabled in all endpoints
- Check that logger.ts is properly imported
- Ensure crypto.randomUUID() is working (Node 18+ required)

**High Error Volume:**

*Symptoms:* Error tracking showing many failures

*Diagnosis:*
```bash
# Analyze error patterns
vercel logs --since 1h | grep '"level":"error"' | head -20

# Look for common error types
vercel logs --since 1h | grep '"level":"error"' | jq '.error.name' | sort | uniq -c
```

*Solutions:*
- Check external service status (ElevenLabs, Coinbase, Supabase)
- Verify environment variables are set correctly
- Review feature flag states
- Consider temporary rollback to mock mode

**Log Analysis Troubleshooting:**

*Query not finding logs:*
```bash
# Use broader search patterns
vercel logs --follow | grep "correlation\|error\|track"

# Check log timestamp issues
vercel logs --since 30m | head -5
```

*Performance investigation:*
```bash
# Find slow operations
vercel logs --since 1h | grep '"duration"' | jq 'select(.duration > 5000)'

# Track specific request end-to-end
vercel logs --follow | grep "correlationId.*YOUR_ID"
```

### ElevenLabs Generation Failures

**Check Logs:**
```bash
# Vercel Functions logs
vercel logs --follow

# Look for: "ElevenLabs generation failed"
```

**Common Causes:**
- API key invalid/expired → Check ELEVEN_API_KEY
- Rate limits → Wait and retry generation
- Service outage → Switch to mock mode temporarily

### Supabase Connection Issues

**Symptoms:** 500 errors on all endpoints

**Check:**
- SUPABASE_URL correct
- SUPABASE_SERVICE_ROLE_KEY valid
- Database accessible from Vercel

### x402 Payment Failures

**Symptoms:** All submissions return 402 but payments aren't verified

**Check:**
- X402_PROVIDER_URL reachable
- X402_RECEIVING_ADDRESS valid
- Coinbase CDP service status

### Playwright Smoke Test Failures

**Test Environment Issues:**

*Symptoms:* Staging smoke tests failing unexpectedly

*Diagnosis:*
```bash
# Run tests locally against staging
STAGING_URL=https://your-staging-app.vercel.app \
ADMIN_TOKEN=your-staging-token \
npm run test:smoke

# Check specific test output
npx playwright test --headed --slowMo=1000
```

*Common Issues:*
- Admin token incorrect or expired
- Staging environment not deployed
- Real services enabled (should be OFF for smoke tests)
- UI elements changed, selectors outdated

**GitHub Actions Failures:**

*Check GitHub secrets:*
- `STAGING_URL` points to correct staging deployment
- `STAGING_ADMIN_TOKEN` matches staging environment variable
- Staging deployment is healthy

*Review CI logs:*
```bash
# Look for pattern:
# "Staging smoke tests failed"
# Check artifact uploads for Playwright reports
```

**Smoke Test Debugging:**

*Run specific test:*
```bash
npx playwright test staging-smoke.spec.ts --headed
```

*Generate debug trace:*
```bash
npx playwright test --trace=on
npx playwright show-trace trace.zip
```

*Check staging health before tests:*
```bash
curl https://your-staging-app.vercel.app/api/station/state
curl https://your-staging-app.vercel.app/api/admin/state \
  -H "Authorization: Bearer $STAGING_ADMIN_TOKEN"
```

## Operational Procedures

### Daily Health Check
1. Check station is playing: `curl $BASE_URL/api/station/state`
2. Verify queue has content: Check queue length > 0
3. Test admin access: `curl $BASE_URL/api/admin/state -H "$AUTH_HEADER"`
4. Review recent errors in Vercel logs

### Weekly Maintenance
1. Rotate admin tokens
2. Review failed track patterns
3. Clean up very old DONE tracks if needed
4. Verify feature flags match intended state

### Emergency Contact
- Check GitHub Issues for known problems
- Review Vercel deployment logs
- Monitor third-party service status pages (ElevenLabs, Coinbase)

## Admin UI Operations

### Accessing Admin Panel

**Development/Staging URL:**
```
https://your-app.vercel.app/?admin=1
```

**Local Development:**
```
http://localhost:5173/?admin=1
```

### Using Admin Panel

1. **Authentication:**
   - Enter your `ADMIN_TOKEN` in the token field
   - Click "Connect" to authenticate
   - Token is saved in browser localStorage for convenience

2. **Station Operations:**
   - **Generate Track**: Manually trigger track generation from PAID queue
   - **Advance Station**: Force station to advance to next track
   - **Refresh State**: Update admin panel with latest data

3. **Track Management:**
   - **Skip Track**: Mark currently playing track as DONE
   - **Requeue Track**: Change DONE/FAILED tracks back to READY
   - **Delete Track**: Permanently remove track from database

### Admin Panel Features

**Now Playing Section:**
- Shows current track details and playhead position
- Quick skip button for emergency track removal

**Queue Management:**
- View all READY, PAID, and GENERATING tracks
- Color-coded status indicators
- Bulk actions for track management

**Recent Tracks:**
- Last 10 completed tracks with ratings
- Requeue popular tracks when queue is empty

### Security Notes

- Admin panel only appears in development builds
- Production deployments hide admin access completely
- Always use secure admin tokens (32+ characters)
- Admin actions are logged to server console
- Token is stored in browser localStorage only

### Troubleshooting Admin Panel

**Panel Not Loading:**
- Check `ADMIN_TOKEN` environment variable is set
- Verify you're accessing `?admin=1` URL correctly
- Check browser console for JavaScript errors

**Authentication Failing:**
- Verify admin token matches environment variable exactly
- Check network tab for 401/404 responses
- Ensure admin endpoints are deployed properly

**Actions Not Working:**
- Check browser network tab for API errors
- Verify server logs for detailed error messages
- Ensure database connectivity is working

---

**Remember:** Admin operations affect live users immediately. Test commands on staging first when possible.