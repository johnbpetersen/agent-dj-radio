# API Reference

## Payment Flow

### POST /api/queue/price-quote

Get pricing for track generation.

**Request:**
```json
{
  "duration_seconds": 120
}
```

**Response:**
```json
{
  "price_usd": 2.50,
  "duration_seconds": 120
}
```

### POST /api/queue/submit

Submit track for generation. Returns 402 payment challenge when `ENABLE_X402=true`.

**Request:**
```json
{
  "prompt": "Dreamy lo-fi beats",
  "duration_seconds": 120,
  "user_id": "uuid"
}
```

**Response (402 Payment Required):**
```json
{
  "challenge": {
    "amount": "2500000",
    "asset": "USDC",
    "chain": "base-sepolia", 
    "payTo": "0x...",
    "nonce": "uuid",
    "expiresAt": "2025-09-06T15:30:00Z"
  },
  "track_id": "track-uuid"
}
```

**Headers:**
- `X-PAYMENT`: JSON string with challenge + track_id
- `X-Payment-Required`: x402
- `X-Payment-Provider`: CDP
- `Access-Control-Expose-Headers`: X-PAYMENT

### POST /api/x402/mock-proof *(dev only)*

Generate mock payment proof for testing.

**Request:**
```json
{
  "track_id": "track-uuid"
}
```

**Response:**
```json
{
  "track_id": "track-uuid",
  "payment_proof": "base64-encoded-proof",
  "challenge": { ... }
}
```

### POST /api/queue/confirm

Verify payment and confirm track. Idempotent - returns success if already PAID.

**Request:**
```json
{
  "track_id": "track-uuid",
  "payment_proof": "base64-encoded-proof"
}
```

**Response:**
```json
{
  "track": {
    "id": "track-uuid",
    "status": "PAID",
    "prompt": "Dreamy lo-fi beats",
    ...
  },
  "payment_verified": true
}
```

**Side Effects:**
- Updates track status to PAID
- Triggers POST /api/worker/generate with track_id
- Broadcasts realtime queue update

## Generation

### POST /api/worker/generate

Process PAID tracks for audio generation. Supports targeted processing.

**Request (Optional):**
```json
{
  "track_id": "specific-track-uuid"
}
```

**Behavior:**
- If `track_id` provided: processes that specific PAID track
- If no `track_id`: claims next PAID track in FIFO order
- Enforces instrumental-only prompts
- Uploads to Supabase Storage with correct MIME type
- Marks track as READY when complete

## User Management

### POST /api/users

Create or find user by display name (case-insensitive).

**Request:**
```json
{
  "display_name": "Alice"
}
```

**Response:**
```json
{
  "user": {
    "id": "user-uuid",
    "display_name": "Alice", 
    "banned": false,
    "created_at": "2025-09-06T14:30:00Z"
  }
}
```

### GET /api/users/[id]

Retrieve user by ID.

**Response:**
```json
{
  "user": {
    "id": "user-uuid",
    "display_name": "Alice",
    "banned": false,
    "created_at": "2025-09-06T14:30:00Z"
  }
}
```

### PATCH /api/users/[id]

Update user display name.

**Request:**
```json
{
  "display_name": "Alice Smith"
}
```

## Example Flows

### Mock Payment Flow
```bash
# 1. Create user
curl -X POST http://localhost:3001/api/users \
  -H 'Content-Type: application/json' \
  -d '{"display_name":"Alice"}'

# 2. Submit track (gets 402)  
curl -X POST http://localhost:3001/api/queue/submit \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"lofi beats","duration_seconds":60,"user_id":"USER_UUID"}'

# 3. Generate mock proof
curl -X POST http://localhost:3001/api/x402/mock-proof \
  -H 'Content-Type: application/json' \
  -d '{"track_id":"TRACK_UUID"}'

# 4. Confirm payment
curl -X POST http://localhost:3001/api/queue/confirm \
  -H 'Content-Type: application/json' \
  -d '{"track_id":"TRACK_UUID","payment_proof":"BASE64_PROOF"}'
```

### Real Payment Flow
Set `X402_API_KEY` environment variable and use real Base Sepolia USDC transactions for payment_proof.