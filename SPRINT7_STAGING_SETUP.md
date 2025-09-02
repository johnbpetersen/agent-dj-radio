# Sprint 7: Staging Beta Rehearsal Setup

## Feature Flag Configuration

For Sprint 7 staging rehearsal, both production feature flags must be enabled:

### Required Environment Variables

Set these environment variables in your staging environment (Vercel dashboard or `.env.local`):

```bash
# Enable real ElevenLabs API integration
ENABLE_REAL_ELEVEN=true

# Enable x402 payment system
ENABLE_X402=true

# Recommended for staging
ENABLE_REQUEST_LOGGING=true
ENABLE_ERROR_TRACKING=true
LOG_LEVEL=info
```

### Prerequisites

Before enabling these flags, ensure you have:

1. **ElevenLabs API Key**
   ```bash
   ELEVEN_API_KEY=your_elevenlabs_api_key_here
   ELEVEN_MUSIC_MODEL_ID=your_model_id_here
   ```

2. **X402 Payment Configuration**
   ```bash
   X402_CHAIN=base-sepolia  # or base for production
   X402_PROVIDER_URL=your_rpc_endpoint
   X402_RECEIVING_ADDRESS=your_wallet_address
   X402_ACCEPTED_ASSET=USDC  # or native ETH
   ```

3. **Supabase Configuration**
   ```bash
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

### Verification Steps

1. **Check Health Dashboard**
   - Navigate to `/?admin=1` 
   - Enter admin token
   - Verify health dashboard shows all services as "up"
   - Confirm feature flags show as enabled

2. **Test ElevenLabs Integration**
   - Submit a track through the UI
   - Check admin panel for track generation
   - Verify audio files are created and playable

3. **Test X402 Payment System**
   - Submit a track (should get 402 Payment Required)
   - Complete payment flow
   - Verify track moves to PAID status

### Environment Variable Deployment

#### Vercel Deployment
```bash
# Set via Vercel CLI
vercel env add ENABLE_REAL_ELEVEN production
vercel env add ENABLE_X402 production

# Or set via Vercel dashboard:
# 1. Go to your project settings
# 2. Navigate to Environment Variables
# 3. Add each variable with value "true"
# 4. Redeploy the application
```

#### Local Development
```bash
# Add to .env.local (create if it doesn't exist)
echo "ENABLE_REAL_ELEVEN=true" >> .env.local
echo "ENABLE_X402=true" >> .env.local
```

### Monitoring

Once flags are enabled:

1. **Monitor Health Endpoint**: `/api/health`
2. **Check Logs**: Vercel function logs for errors
3. **Database Monitoring**: Track generation success rates
4. **Payment Monitoring**: X402 payment confirmations

### Rollback Plan

If issues occur, quickly disable flags:

```bash
# Disable via environment variables
ENABLE_REAL_ELEVEN=false
ENABLE_X402=false

# Or remove variables entirely to use defaults (false)
```

### Expected Behavior Changes

With flags enabled:

- **Track Submission**: Requires payment (402 responses)
- **Music Generation**: Uses real ElevenLabs API
- **Storage**: Audio files stored in Supabase Storage
- **Costs**: Real API usage charges apply
- **Performance**: Actual generation latency (30-60s)

### Security Considerations

- Ensure API keys are properly secured
- Monitor API usage to prevent abuse
- Verify rate limiting is working
- Check CORS policies are enforced
- Confirm sensitive data is sanitized

This setup enables full production-like behavior for final testing before live deployment.