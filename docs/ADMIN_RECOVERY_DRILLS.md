# Admin Recovery Drills - Sprint 7

## Overview

This document outlines emergency recovery procedures for common production incidents. Practice these drills during Sprint 7 staging rehearsal to ensure readiness.

## Drill 1: Station Stuck / Not Advancing

### Symptoms
- Current track shows as playing but has exceeded duration
- No new tracks being picked up from queue
- Users reporting silence or frozen playback

### Recovery Steps

1. **Diagnose via Admin Panel**
   ```
   1. Access /?admin=1
   2. Check health dashboard
   3. Look at station state and playhead
   4. Review queue status
   ```

2. **Manual Station Advance**
   ```
   1. Click "Advance Station" in admin panel
   2. Verify new track starts playing
   3. Check playhead is updating
   ```

3. **If Manual Advance Fails**
   ```bash
   # Via API directly
   curl -X POST https://your-app.vercel.app/api/station/advance \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
   ```

4. **Database Direct Fix** (Last Resort)
   ```sql
   -- Update station state to clear current track
   UPDATE station_state 
   SET current_track_id = NULL, 
       current_started_at = NULL 
   WHERE id = 1;
   
   -- Mark stuck track as DONE
   UPDATE tracks 
   SET status = 'DONE', 
       finished_at = NOW() 
   WHERE status = 'PLAYING';
   ```

### Prevention
- Monitor station advances every 5 minutes
- Set up alerts for stuck tracks
- Ensure cron job is running properly

---

## Drill 2: Track Generation Failures

### Symptoms
- Tracks stuck in GENERATING status
- Queue depleting without new content
- ElevenLabs API errors

### Recovery Steps

1. **Check ElevenLabs Status**
   ```
   1. Review health dashboard
   2. Check ElevenLabs service status
   3. Verify API key is valid
   ```

2. **Clear Stuck Tracks**
   ```sql
   -- Mark old generating tracks as failed
   UPDATE tracks 
   SET status = 'FAILED' 
   WHERE status = 'GENERATING' 
   AND created_at < NOW() - INTERVAL '10 minutes';
   ```

3. **Regenerate Failed Tracks**
   ```
   1. Use admin panel to manually trigger generation
   2. Or requeue failed tracks as new submissions
   ```

4. **Emergency Fallback**
   ```
   1. Disable ENABLE_REAL_ELEVEN temporarily
   2. Allow mock tracks to queue up
   3. Re-enable once issue is resolved
   ```

### Prevention
- Monitor generation success rates
- Set timeout limits for stuck tracks
- Have backup content ready

---

## Drill 3: Payment System Issues

### Symptoms
- Users cannot complete payments
- 402 responses not working
- Blockchain connectivity issues

### Recovery Steps

1. **Check X402 Configuration**
   ```
   1. Verify RPC endpoint connectivity
   2. Check receiving wallet address
   3. Test blockchain network status
   ```

2. **Validate Recent Payments**
   ```sql
   -- Check recent payment confirmations
   SELECT * FROM x402_payment_audit 
   WHERE created_at > NOW() - INTERVAL '1 hour' 
   ORDER BY created_at DESC;
   ```

3. **Emergency Free Mode**
   ```bash
   # Temporarily disable payments
   ENABLE_X402=false
   
   # All tracks will be created as PAID immediately
   ```

4. **Manual Payment Confirmation**
   ```sql
   -- If payment was made but not confirmed
   UPDATE tracks 
   SET status = 'PAID', 
       x402_payment_tx = 'manual_confirmation_TXHASH' 
   WHERE id = 'TRACK_ID' 
   AND status = 'PENDING_PAYMENT';
   ```

### Prevention
- Monitor blockchain network health
- Have backup payment methods ready
- Test payment flow regularly

---

## Drill 4: Database Connection Issues

### Symptoms
- 500 errors on all endpoints
- Health check showing database down
- Supabase connectivity issues

### Recovery Steps

1. **Check Supabase Status**
   ```
   1. Visit Supabase dashboard
   2. Check project status
   3. Review connection limits
   ```

2. **Verify Service Role Key**
   ```bash
   # Test database connection
   curl "https://YOUR_PROJECT.supabase.co/rest/v1/tracks?select=count" \
     -H "apikey: YOUR_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
   ```

3. **Connection Pool Issues**
   ```
   1. Check current connection count
   2. May need to restart Vercel functions
   3. Consider connection pooling limits
   ```

4. **Emergency Read-Only Mode**
   ```typescript
   // Temporarily disable writes
   if (req.method !== 'GET') {
     return res.status(503).json({ 
       error: 'Service temporarily unavailable' 
     })
   }
   ```

### Prevention
- Monitor connection pool usage
- Have database failover ready
- Set up proper alerting

---

## Drill 5: Rate Limiting Issues

### Symptoms
- Legitimate users getting 429 errors
- Rate limit headers showing excessive blocks
- Normal traffic being rejected

### Recovery Steps

1. **Check Rate Limit Store**
   ```javascript
   // In-memory store may be full
   // Restart application to clear
   ```

2. **Adjust Rate Limits Temporarily**
   ```typescript
   // In secure-handler.ts, increase limits
   public: { 
     rateLimitOptions: { windowMs: 60000, maxRequests: 200 } // Doubled
   }
   ```

3. **IP Allowlisting**
   ```typescript
   // Skip rate limiting for trusted IPs
   const trustedIPs = ['1.2.3.4', '5.6.7.8']
   if (trustedIPs.includes(clientIP)) {
     // Skip rate limiting
   }
   ```

4. **Emergency Disable**
   ```typescript
   // Temporarily remove rate limiting
   if (options.rateLimitOptions) {
     // Comment out rate limiting logic
   }
   ```

### Prevention
- Use Redis for distributed rate limiting
- Monitor rate limit hit rates
- Have IP whitelisting ready

---

## Drill 6: CORS / Security Issues

### Symptoms
- Frontend cannot connect to API
- CORS errors in browser console
- Unexpected origins being blocked

### Recovery Steps

1. **Check Allowed Origins**
   ```typescript
   // In security.ts, verify ALLOWED_ORIGINS
   const ALLOWED_ORIGINS = [
     'http://localhost:5173',
     'http://localhost:3000',
     process.env.VITE_SITE_URL, // Check this value
   ]
   ```

2. **Temporary Origin Expansion**
   ```typescript
   // Add emergency origins
   const EMERGENCY_ORIGINS = [
     'https://your-backup-domain.com'
   ]
   ```

3. **Bypass CORS Temporarily**
   ```typescript
   // Emergency: allow all origins (security risk!)
   res.setHeader('Access-Control-Allow-Origin', '*')
   ```

### Prevention
- Keep origin list updated
- Test CORS policy changes
- Have backup domains ready

---

## General Recovery Checklist

### Before Any Action
- [ ] Check health dashboard first
- [ ] Identify scope of impact
- [ ] Notify team of investigation
- [ ] Document timeline

### During Recovery
- [ ] Test each step in staging first
- [ ] Monitor impact of changes
- [ ] Keep stakeholders updated
- [ ] Document what you're doing

### After Recovery
- [ ] Verify full system functionality
- [ ] Run health checks
- [ ] Document root cause
- [ ] Create prevention measures

## Emergency Contacts

- **Database Issues**: Supabase Support
- **API Issues**: ElevenLabs Support  
- **Hosting Issues**: Vercel Support
- **Team Lead**: [Add contact info]

## Monitoring Endpoints

- Health: `GET /api/health`
- Station State: `GET /api/station/state`
- Admin Panel: `/?admin=1`

Remember: Always test recovery procedures in staging before applying to production!