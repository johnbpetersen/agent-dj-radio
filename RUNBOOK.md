# Agent DJ Radio - Operations Runbook

## Security Configuration (Sprint 6)

### Overview
Sprint 6 implemented comprehensive security hardening including RLS, CORS lockdown, rate limiting, and data sanitization. All API endpoints are now protected with security middleware.

### Security Features

#### 1. Row Level Security (RLS)
- **Location**: `supabase/schema-sprint6-rls.sql`
- **Coverage**: Users, tracks, reactions, and payment audit tables
- **Anonymous Support**: Anonymous users can read public tracks and submit reactions
- **Administration**: Service role bypasses RLS for admin operations

#### 2. CORS and Security Headers
- **Implementation**: `api/_shared/security.ts`
- **Allowed Origins**: Configured in `ALLOWED_ORIGINS` array
  - `http://localhost:5173` (Development)
  - `http://localhost:3000` (Vercel dev)
  - `process.env.VITE_SITE_URL` (Production/Staging)
- **Security Headers**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - Comprehensive Content Security Policy (CSP)

#### 3. Rate Limiting
- **Implementation**: In-memory rate limiting per IP address
- **Configurations**:
  - Public endpoints: 100 requests/minute
  - User endpoints: 30 requests/minute
  - Admin endpoints: 60 requests/minute
  - Worker endpoints: 120 requests/minute

#### 4. Data Sanitization
- **Function**: `sanitizeForClient()` in `api/_shared/security.ts`
- **Always Removed Fields**:
  - `x402_payment_tx`
  - `eleven_request_id`
  - `service_role_key`
  - `api_key`
  - `secret`
  - `token`
  - `password`
  - `private_key`

### Security Middleware

#### Secure Handler
- **Location**: `api/_shared/secure-handler.ts`
- **Purpose**: Wraps all API endpoints with security middleware
- **Features**:
  - CORS and security header application
  - Rate limiting enforcement
  - Request/response logging
  - Error handling and sanitization

#### Configuration Profiles
```typescript
// Public endpoints (station state)
securityConfigs.public = {
  allowedMethods: ['GET', 'OPTIONS'],
  rateLimitOptions: { windowMs: 60000, maxRequests: 100 },
  logRequests: true
}

// User endpoints (queue, reactions)
securityConfigs.user = {
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
  rateLimitOptions: { windowMs: 60000, maxRequests: 30 },
  logRequests: true,
  requireValidOrigin: true
}

// Admin endpoints
securityConfigs.admin = {
  allowedMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  rateLimitOptions: { windowMs: 60000, maxRequests: 60 },
  logRequests: true,
  requireValidOrigin: true
}

// Worker endpoints (cron jobs)
securityConfigs.worker = {
  allowedMethods: ['POST', 'OPTIONS'],
  rateLimitOptions: { windowMs: 60000, maxRequests: 120 },
  logRequests: true
}
```

### Legal Compliance

#### Privacy Policy
- **Endpoint**: `/api/legal/privacy`
- **Content**: Comprehensive privacy policy covering data collection, usage, sharing
- **Third-party Services**: ElevenLabs, Supabase, Vercel

#### Terms of Service
- **Endpoint**: `/api/legal/terms`
- **Content**: Detailed terms covering acceptable use, payments, intellectual property
- **Blockchain**: Covers Base blockchain and USDC payment terms

### Security Operations

#### Secret Rotation
Rotate these secrets regularly in staging/production:

1. **Supabase Service Role Key**
   - Generate new key in Supabase dashboard
   - Update `SUPABASE_SERVICE_ROLE_KEY` environment variable
   - Verify RLS policies work correctly

2. **ElevenLabs API Key**
   - Generate new key in ElevenLabs dashboard
   - Update `ELEVEN_API_KEY` environment variable
   - Test music generation functionality

3. **Admin Token**
   - Generate cryptographically secure random token
   - Update `ADMIN_TOKEN` environment variable
   - Verify admin endpoints still work

#### Security Monitoring
- Monitor rate limit headers in responses
- Check error logs for security violations
- Verify CORS policy effectiveness
- Audit data sanitization in client responses

#### Security Testing
```bash
# Test CORS policy
curl -H "Origin: https://malicious-site.com" https://your-app.vercel.app/api/station/state

# Test rate limiting
for i in {1..150}; do curl https://your-app.vercel.app/api/station/state; done

# Verify data sanitization
curl https://your-app.vercel.app/api/station/state | jq | grep -E "(eleven_request_id|x402_payment_tx)"
```

### Incident Response

#### Security Breach
1. Check rate limiting logs for unusual activity
2. Verify CORS headers are properly set
3. Audit recent API responses for data leaks
4. Rotate affected secrets immediately
5. Review RLS policy violations

#### Rate Limiting Issues
1. Check current rate limit storage size
2. Verify IP address extraction logic
3. Adjust rate limits if legitimate traffic blocked
4. Consider implementing Redis for distributed rate limiting

### Maintenance

#### Regular Tasks
- Weekly secret rotation in staging
- Monthly security header review
- Quarterly RLS policy audit
- Verify data sanitization coverage for new endpoints

#### Updates
- All new API endpoints must use `secureHandler()`
- New database fields containing sensitive data must be added to sanitization
- CORS origins must be updated when domains change
- Rate limits may need adjustment based on usage patterns

## Deployment

### Environment Variables
Ensure these are set in production:
- `VITE_SITE_URL`: Your production domain
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (rotated)
- `ELEVEN_API_KEY`: ElevenLabs API key (rotated)
- `ADMIN_TOKEN`: Admin authentication token (rotated)

### Database Setup
1. Apply RLS policies: `supabase db reset` or run `schema-sprint6-rls.sql`
2. Verify RLS policies are active: `SELECT * FROM pg_policies;`
3. Test anonymous and authenticated access patterns

### Verification Checklist
- [ ] All API endpoints return proper CORS headers
- [ ] Rate limiting is working (test with curl)
- [ ] No sensitive data in client responses
- [ ] RLS policies block unauthorized access
- [ ] Legal endpoints return proper content
- [ ] Admin endpoints require authentication
- [ ] Error responses don't leak internal information