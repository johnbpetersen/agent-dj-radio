# Configuration Reference

## Environment Variables

| Key | Required | Example | Purpose |
|-----|----------|---------|---------|
| **Payment (x402)** |
| `ENABLE_X402` | Yes | `true` | Toggle payment gating on/off |
| `X402_PROVIDER_URL` | Yes | `https://api.cdp.coinbase.com/x402` | Payment verification endpoint |
| `X402_API_KEY` | Dev: No, Prod: Yes | `cb_api_key_...` | Real provider API key (unset = mock mode) |
| `X402_ACCEPTED_ASSET` | Yes | `USDC` | Asset accepted for payments |
| `X402_CHAIN` | Yes | `base-sepolia` | Blockchain network |
| `X402_RECEIVING_ADDRESS` | Yes | `0x1234...` | Merchant wallet address |
| **Audio Generation** |
| `ENABLE_REAL_ELEVEN` | Yes | `true` | Use real ElevenLabs API vs mock |
| `ELEVEN_API_KEY` | If real | `sk_...` | ElevenLabs API key |
| `ELEVEN_MUSIC_MODEL_ID` | Yes | `eleven_music_v1` | Model for generation |
| **Infrastructure** |
| `VITE_SITE_URL` | Yes | `http://localhost:5173` | Base URL for worker callbacks |
| `SUPABASE_URL` | Yes | `https://xxx.supabase.co` | Database and storage |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | `eyJhbGci...` | Admin access for API routes |
| `SB_TRACKS_BUCKET` | Yes | `tracks` | Storage bucket name |
| **Logging & Monitoring** |
| `ENABLE_REQUEST_LOGGING` | Optional | `true` | Detailed API logging |
| `ENABLE_ERROR_TRACKING` | Optional | `true` | Error reporting |

## Feature Flag Combinations

### Development Mode
```bash
ENABLE_X402=true
# X402_API_KEY unset (uses mock verification)
ENABLE_REAL_ELEVEN=false
```

### Staging Mode  
```bash
ENABLE_X402=true
X402_API_KEY=your_test_key
ENABLE_REAL_ELEVEN=true
```

### Production Mode
```bash
ENABLE_X402=true
X402_API_KEY=your_production_key  
ENABLE_REAL_ELEVEN=true
```

## Frontend Configuration

The frontend reads these headers from API responses:

- `X-PAYMENT`: JSON payment challenge data
- `X-Payment-Required`: Payment scheme indicator
- `Access-Control-Expose-Headers`: CORS header exposure

## Storage Configuration

Supabase Storage bucket `tracks` must:
- Allow authenticated uploads from service role
- Serve files publicly for audio playback
- Accept `.mp3` and `.wav` file extensions

## Security Notes

- Service role key bypasses RLS - keep secure
- Payment addresses should be real wallet addresses you control
- Mock mode is for development only - never use in production