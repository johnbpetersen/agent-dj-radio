# Operational Runbook

## Development Setup

### Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Configure environment (copy real Supabase credentials)
cp .env.example .env.local
# Edit .env.local with real values

# 3. Apply database migrations
# Run SQL from docs/MIGRATIONS.md in Supabase SQL editor

# 4. Start development servers  
npm run dev
```

### Environment Configurations

#### Mock Development Mode
```bash
# .env.local
ENABLE_X402=true
ENABLE_REAL_ELEVEN=false
# X402_API_KEY unset (mock payments)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

#### Real Integration Testing
```bash  
# .env.local
ENABLE_X402=true
ENABLE_REAL_ELEVEN=true
X402_API_KEY=your_test_api_key
ELEVEN_API_KEY=your_eleven_api_key
```

## End-to-End Testing

### Mock Payment Flow

**Prerequisites:**
- `ENABLE_X402=true` 
- `X402_API_KEY` unset (mock mode)
- Development server running on localhost:5173

**Test Steps:**

1. **Create User Identity**
   - Open http://localhost:5173
   - Enter display name "Test User"
   - Verify name persists on refresh

2. **Submit Track for Payment**
   - Enter prompt: "Dreamy lo-fi instrumental"
   - Select 60 seconds duration
   - Click "Get Price Quote" 
   - Click "Submit for $X.XX"
   - **Expected:** 402 payment modal appears with challenge details

3. **Generate Mock Payment**
   - In payment modal, click "Generate Mock Payment"
   - **Expected:** Payment proof field populates with base64 data

4. **Confirm Payment**
   - Click "Confirm Payment"
   - **Expected:** Modal closes, track shows "Generating..."

5. **Verify Audio Generation**
   - Wait 10-30 seconds for generation
   - **Expected:** Track appears as "Ready" in queue
   - **Check:** Supabase Storage bucket has new audio file

6. **Verify Playback**
   - Wait for station to advance (or trigger manually in admin)
   - **Expected:** Track begins playing with audio controls

### Real Payment Flow

**Prerequisites:**
- Set `X402_API_KEY` to real Coinbase CDP key
- Have funded Base Sepolia wallet
- Same steps as mock, but use real USDC transaction for payment_proof

### API Testing with cURL

```bash
# 1. Create user
USER_RESPONSE=$(curl -s -X POST http://localhost:3001/api/users \
  -H 'Content-Type: application/json' \
  -d '{"display_name":"Test User"}')
USER_ID=$(echo $USER_RESPONSE | jq -r '.user.id')

# 2. Submit track (expect 402)
SUBMIT_RESPONSE=$(curl -s -X POST http://localhost:3001/api/queue/submit \
  -H 'Content-Type: application/json' \
  -d "{\"prompt\":\"lofi instrumental\",\"duration_seconds\":60,\"user_id\":\"$USER_ID\"}")
TRACK_ID=$(echo $SUBMIT_RESPONSE | jq -r '.track_id')

# 3. Generate mock proof
PROOF_RESPONSE=$(curl -s -X POST http://localhost:3001/api/x402/mock-proof \
  -H 'Content-Type: application/json' \
  -d "{\"track_id\":\"$TRACK_ID\"}")
PAYMENT_PROOF=$(echo $PROOF_RESPONSE | jq -r '.payment_proof')

# 4. Confirm payment
curl -s -X POST http://localhost:3001/api/queue/confirm \
  -H 'Content-Type: application/json' \
  -d "{\"track_id\":\"$TRACK_ID\",\"payment_proof\":\"$PAYMENT_PROOF\"}"
```

## Troubleshooting

### Payment Issues

**Problem:** Confirm returns success but wrong track generates  
**Solution:** Ensure worker receives correct `track_id` parameter. Check that only one PAID track exists for that ID in database.

**Problem:** 402 modal doesn't show payment challenge  
**Solution:** Verify `ENABLE_X402=true` and check browser network tab for X-PAYMENT header in 402 response.

**Problem:** Mock proof generation fails  
**Solution:** Ensure track exists in PENDING_PAYMENT status and has x402_challenge_* columns populated.

### Audio Generation Issues

**Problem:** ElevenLabs returns "bad_prompt" error  
**Solution:** Current behavior fails track to FAILED status. If `ENABLE_REAL_ELEVEN=false`, falls back to mock audio. See "Deferred" section for auto-retry plans.

**Problem:** Generated audio has wrong MIME type  
**Solution:** Worker now sets correct content-type based on file extension. Verify Supabase Storage shows audio/mpeg for .mp3 files.

**Problem:** Worker processes wrong track  
**Solution:** Confirm endpoint passes `track_id` to worker. Check worker logs for "Processing specific track" vs "No specific track, claiming next".

### Infrastructure Issues

**Problem:** Duplicate station advance logs  
**Solution:** Only run station cron OR manual advance, not both. Check for multiple cron jobs or manual triggers.

**Problem:** Realtime updates not reaching frontend  
**Solution:** Verify Supabase Realtime is enabled and `broadcastQueueUpdate()` calls succeed. Check browser console for WebSocket connections.

**Problem:** 404 on /api/users/[id] in development  
**Solution:** Use fallback route `/api/users-get?id=UUID` if dev server doesn't support dynamic routing.

## Monitoring & Logs

### Key Log Messages
- `queue/submit request` - Track submission started
- `queue/confirm payment confirmed` - Successful payment verification
- `Processing specific track` - Worker handling targeted generation
- `No specific track, claiming next` - Worker in FIFO mode
- `Storage upload completed` - Audio file saved successfully

### Database Queries for Health
```sql
-- Check payment flow health
SELECT status, COUNT(*) FROM tracks 
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY status;

-- Recent payment audit events
SELECT event_type, COUNT(*) FROM payment_audit
WHERE created_at > NOW() - INTERVAL '1 hour'  
GROUP BY event_type;

-- Generation latency
SELECT 
  AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) as avg_generation_seconds
FROM tracks 
WHERE status = 'READY' 
  AND finished_at > NOW() - INTERVAL '1 day';
```

## Production Deployment

### Pre-deployment Checklist
- [ ] All environment variables set with production values
- [ ] Database migrations applied
- [ ] Storage bucket configured with proper CORS
- [ ] Real payment provider API keys configured
- [ ] ElevenLabs API key with sufficient credits
- [ ] Health check endpoint `/api/health` returns 200

### Deployment Steps
1. Deploy to Vercel/hosting platform
2. Run smoke test with real payment flow
3. Monitor logs for first 30 minutes
4. Verify audio generation pipeline working
5. Test station advancement and playback

### Post-deployment Verification
- [ ] Mock payment flow works end-to-end
- [ ] Real payment flow works (if enabled)  
- [ ] Audio files uploading to correct bucket
- [ ] Realtime updates broadcasting to connected clients
- [ ] Admin endpoints accessible with proper auth