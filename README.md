# 🎵 Agent DJ Radio - Sprint 2 MVP

A real-time AI-generated music station where users pay to queue short songs that play for everyone. Now featuring real ElevenLabs AI music generation, HTTP 402 payment challenges via Coinbase CDP, and instant updates via Supabase Realtime.

## 🚀 Features

### Core Features
- **Single Station**: One shared radio station for all users
- **Queue System**: Submit AI-generated song prompts (60/90/120 seconds)
- **Live Playback**: Real-time audio streaming with progress tracking
- **Reactions**: Love ❤️, Fire 🔥, or Skip ⏭️ tracks to build ratings
- **Smart Replays**: Highly-rated tracks automatically replay when queue is empty

### Sprint 2 Additions ⭐
- **Real AI Music**: ElevenLabs Music API integration with 3-minute timeout
- **x402 Payments**: HTTP 402 payment challenges via Coinbase CDP; USDC on Base/Base-Sepolia with 15-minute expiration
- **Instant Updates**: Supabase Realtime for queue changes and station updates
- **Rate Limiting**: 60-second cooldown per user submission
- **Feature Flags**: Toggle between mock/real integrations for gradual rollout
- **Concurrency Control**: Database locks prevent multiple workers processing same track

### Sprint 3 Additions 🛠️
- **Admin Controls**: Secure API endpoints for manual station management
- **Emergency Operations**: Skip tracks, force generation, advance station manually
- **Admin Monitoring**: Real-time visibility into queue state and recent activity
- **Production Ready**: Token-based security with staging launch readiness

## 🛠 Tech Stack

**Frontend:**
- Vite + React 18 + TypeScript
- Tailwind CSS for styling
- Supabase Realtime subscriptions + 5s polling fallback

**Backend:**
- Vercel Serverless Functions
- Supabase (PostgreSQL + Storage)
- Dual client setup (anon + service role)

**Testing:**
- Vitest + Testing Library
- MSW for API mocking
- Comprehensive unit + integration tests

## 📋 Prerequisites

- Node.js 18+ and npm
- Supabase project with database access
- Basic knowledge of React and TypeScript

## 🏃‍♂️ Quick Start

### 1. Clone and Install
```bash
git clone <repository-url>
cd agent-dj-radio
npm install
```

### 2. Environment Setup
```bash
cp .env.example .env.local
```

Fill in your configuration using the environment variable tables below.

### 3. Database Setup
Run the SQL schema in your Supabase dashboard:
```bash
# Copy contents of supabase/schema.sql into Supabase SQL editor
```

### 4. Add Sample Audio
Replace `public/sample-track.mp3` with an actual MP3 file, or use any audio file for testing.

### 5. Development (Two Terminals)
```bash
# Terminal 1: Start Vercel functions (localhost:3000)
npx vercel dev

# Terminal 2: Start Vite frontend (localhost:5173)
npm run dev
```

### 6. Testing
```bash
# Run tests
npm test

# Run tests with UI
npm run test:ui

# Type checking
npm run typecheck
```

## 📚 API Documentation

### Queue Endpoints
- `POST /api/queue/price-quote` - Get pricing for track duration
- `POST /api/queue/submit` - Submit track (returns 201 or 402 challenge)
- `POST /api/queue/confirm` - Confirm x402 payment with proof

### Worker Endpoints  
- `POST /api/worker/generate` - AI generation with ElevenLabs (PAID → READY)

### Station Endpoints
- `GET /api/station/state` - Current playing track + queue
- `POST /api/station/advance` - Advance to next track + broadcast updates

### Reactions Endpoint
- `POST /api/reactions` - Add reaction and update rating

### Cron Jobs (Vercel)
- `POST /api/worker/generate` - Every minute for track processing (idempotent)
- `POST /api/station/advance` - Every minute for station progression (idempotent)

*Note: Vercel Cron runs minutely; handlers are idempotent; UI also polls every ~5s and uses Supabase Realtime.*

## 🏗 Architecture

### Directory Structure
```
agent-dj-radio/
├── src/
│   ├── components/          # React components
│   ├── hooks/               # Custom hooks (polling)
│   ├── lib/                 # Supabase client (anon)
│   ├── server/              # Pure business logic
│   ├── types/               # TypeScript definitions
│   └── test/                # Test setup + mocks
├── api/                     # Vercel functions
│   ├── _shared/             # Service role client
│   ├── queue/               # Queue management
│   ├── station/             # Station control
│   └── worker/              # Background processing
├── tests/                   # Test suites
└── supabase/                # Database schema
```

### Data Flow

#### Sprint 1 Mode (Mock):
1. **Submit**: User submits prompt → Creates PAID track immediately
2. **Generate**: Worker processes PAID → READY with mock/real audio URL
3. **Play**: Station advances READY → PLAYING → DONE
4. **React**: Users react to tracks, updating ratings
5. **Replay**: When queue empty, best DONE tracks become REPLAY tracks

#### Sprint 2 Mode (x402):
1. **Submit**: User submits prompt → Creates PENDING_PAYMENT + returns 402 challenge
2. **Payment**: User pays HTTP 402 challenge → Confirms payment via `/confirm`
3. **Generate**: Worker claims PAID track → ElevenLabs generation → READY
4. **Play**: Station advances READY → PLAYING → DONE + broadcasts updates
5. **React**: Users react to tracks, updating ratings
6. **Replay**: When queue empty, best DONE tracks become REPLAY tracks

### Business Logic
- **Pricing**: $0.05/second base rate with duration discounts (60s: $3.00, 90s: $4.28, 120s: $5.40)
- **Selection**: READY tracks (FIFO) → Best DONE tracks (rating + time since last played)
- **Ratings**: Love (+2), Fire (+1), Skip (-1), averaged across all reactions

## 🧪 Testing

### Run Tests
```bash
npm run test        # Run all tests
npm run test:ui     # Visual test runner
npm test pricing    # Run specific test file
```

### Test Coverage
- ✅ Pricing calculations and validation
- ✅ Track selection algorithms (READY > REPLAY)
- ✅ Reaction aggregation and rating updates
- ✅ API endpoints with comprehensive validation
- ✅ Complete user flows (submit → generate → play)
- ✅ Edge cases (empty queues, time calculations, replays)

## 🔧 Development Notes

### Sprint 1 Limitations
- **No real payments**: All submissions auto-marked as PAID
- **Mock generation**: Uses `sample-track.mp3` placeholder
- **No authentication**: User management simplified
- **Polling only**: No real-time WebSocket updates
- **Single station**: Multi-room support planned for later

### Debug Controls
The app includes debug buttons in development:
- Force advance station
- Trigger generation manually
- Refresh station state

### Database Schema
Key tables: `users`, `tracks`, `reactions`, `station_state`
- Proper constraints and enums enforced at DB level
- Efficient indexes for common queries
- No RLS in Sprint 1 (service role handles access)

## 🚧 Deployment & Production

### Staging Deployment

**1. Supabase Staging Setup:**
```bash
# Create separate Supabase project for staging
# Copy schema from production to staging project
# Update .env.staging with staging Supabase credentials
```

**2. Vercel Staging Project:**
```bash
# Connect staging branch to separate Vercel project
# Use vercel.staging.json for staging-specific configuration
# Set staging environment variables in Vercel dashboard
```

**3. Staging Environment Variables:**
```env
NODE_ENV=staging
VITE_SITE_URL=https://agent-dj-radio-staging.vercel.app

# Staging Supabase
VITE_SUPABASE_URL=https://your-staging-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-staging-service-role-key

# Keep services OFF for reliable smoke testing
ENABLE_REAL_ELEVEN=false
ENABLE_X402=false

# Required for admin operations and smoke tests
ADMIN_TOKEN=your-secure-staging-admin-token

# Logging and monitoring
LOG_LEVEL=info
ENABLE_REQUEST_LOGGING=true
ENABLE_ERROR_TRACKING=true
```

**4. Staging Smoke Tests:**
```bash
# Run smoke tests against staging
npm run test:smoke

# Set environment variables for CI
STAGING_URL=https://agent-dj-radio-staging.vercel.app
ADMIN_TOKEN=your-staging-admin-token
```

### Production Deployment

**1. Production Checklist:**
- ✅ Database schema deployed via Supabase dashboard
- ✅ Environment variables configured (see tables below)
- ✅ Supabase Storage bucket `tracks` created with public access
- ✅ Feature flags set appropriately for your deployment
- ✅ Admin token configured and secured
- ✅ Structured logging enabled
- ✅ Error tracking configured
- ✅ Smoke tests passing on staging

**2. Vercel Production Setup:**
```bash
# Connect main branch to production Vercel project
# Set production environment variables
# Enable Vercel Analytics and Speed Insights
# Configure custom domain if needed
```

**3. Feature Flag Rollout Strategy:**
```bash
# Stage 1: Staging with mock services (current)
ENABLE_REAL_ELEVEN=false
ENABLE_X402=false

# Stage 2: Staging with real ElevenLabs
ENABLE_REAL_ELEVEN=true  
ENABLE_X402=false

# Stage 3: Production with real ElevenLabs
ENABLE_REAL_ELEVEN=true
ENABLE_X402=false

# Stage 4: Full production with payments
ENABLE_REAL_ELEVEN=true
ENABLE_X402=true
```

### Monitoring & Observability

**Structured Logging:**
- All API requests logged with correlation IDs
- Cron job execution timing and results
- Track lifecycle state changes
- Admin operations audit trail

**Error Tracking:**
- Application errors with full context
- Performance issues and timeouts
- Business logic failures
- External service integration errors

**Health Monitoring:**
```bash
# Smoke test endpoints
GET /api/station/state  # Basic health
GET /api/admin/state    # Admin functionality (with auth)

# Cron job monitoring via logs
POST /api/worker/generate  # Should complete < 10s
POST /api/station/advance  # Should complete < 5s
```

## 📝 Environment Variables

### Frontend (Vite) Environment Variables
Copy-paste into your `.env.local`:

```env
# Required for frontend
VITE_SITE_URL=http://localhost:5173
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Server (Vercel Functions) Environment Variables
Set these in Vercel dashboard or `.env.local`:

```env
# Required for server functions
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Feature flags (strings - must be 'true' to enable)
ENABLE_REAL_ELEVEN=false
ENABLE_X402=false

# ElevenLabs (required if ENABLE_REAL_ELEVEN='true')
ELEVEN_API_KEY=your-elevenlabs-key
ELEVEN_MUSIC_MODEL_ID=eleven_music_v1

# x402 via Coinbase CDP (required if ENABLE_X402='true')
X402_PROVIDER_URL=https://api.cdp.coinbase.com/x402
X402_ACCEPTED_ASSET=USDC
X402_CHAIN=base-sepolia
X402_RECEIVING_ADDRESS=your-receiving-address

# Admin Controls (optional - enables admin API endpoints)
ADMIN_TOKEN=your-secure-admin-token-here
```

**Note**: Feature flags use string comparison: `process.env.ENABLE_REAL_ELEVEN === 'true'`

## 🔧 Admin Controls

Admin endpoints provide manual control over station operations for emergency situations and production management.

### Security
- Admin endpoints are **disabled by default** (return 404 when `ADMIN_TOKEN` not set)
- Require `Authorization: Bearer <ADMIN_TOKEN>` header
- Return 401 for missing/invalid tokens
- Never expose admin functionality in public UI

### Admin API Endpoints

#### Generate Track
```bash
curl -X POST http://localhost:3000/api/admin/generate \
  -H "Authorization: Bearer your-admin-token"
```
Triggers worker to process one PAID track. Returns `processed: false` if no tracks available.

#### Advance Station
```bash
curl -X POST http://localhost:3000/api/admin/advance \
  -H "Authorization: Bearer your-admin-token"
```
Forces station to advance to next track. Marks current track as DONE and starts next READY track.

#### Get Station State
```bash
curl http://localhost:3000/api/admin/state \
  -H "Authorization: Bearer your-admin-token"
```
Returns current station state, queue, and recent tracks for monitoring.

#### Skip Track
```bash
curl -X POST http://localhost:3000/api/admin/track/TRACK_ID \
  -H "Authorization: Bearer your-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"action": "skip"}'
```
Marks track as DONE immediately. If currently playing, clears from station.

#### Requeue Track
```bash
curl -X POST http://localhost:3000/api/admin/track/TRACK_ID \
  -H "Authorization: Bearer your-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"action": "requeue"}'
```
Changes DONE/FAILED track back to READY status for replay.

#### Delete Track
```bash
curl -X DELETE http://localhost:3000/api/admin/track/TRACK_ID \
  -H "Authorization: Bearer your-admin-token"
```
Permanently removes track from database.

### Admin UI (Development)

For development and staging environments, you can access a web-based admin interface:

1. **Access Admin Panel:**
   ```
   http://localhost:5173/?admin=1
   ```
   
2. **Enter Admin Token:** Use the token from your `ADMIN_TOKEN` environment variable

3. **Available Operations:**
   - **Generate Track**: Trigger manual track generation
   - **Advance Station**: Force station to next track
   - **Refresh State**: Update admin panel data
   - **Skip Track**: Mark current track as done
   - **Requeue Track**: Move DONE/FAILED track back to READY
   - **Delete Track**: Permanently remove track

**Security Notes:**
- Admin panel is **only accessible in development mode** (`import.meta.env.DEV`)
- Production builds hide the admin link completely
- Always use strong, unique admin tokens
- Admin token is stored in browser localStorage

### Emergency Procedures
See [docs/RUNBOOK.md](docs/RUNBOOK.md) for detailed operational procedures.

## 🚧 Next Steps (Sprint 4+)

### Planned Features
- **User Authentication**: Proper login and user management
- **Multi-room Support**: Multiple stations/genres
- **Advanced Features**: Stems, HLS streaming, scheduled content
- **Mobile Optimization**: Progressive Web App features
- **Analytics Dashboard**: Track usage, revenue, popular prompts

### Current Limitations
- Audio sync may drift over time
- No offline handling or retry logic
- Simple in-memory rate limiting (resets on server restart)
- Single-station architecture

## 🤝 Contributing

1. Run tests: `npm test`
2. Check types: `npm run typecheck`
3. Follow existing code style
4. Update tests for new features

## 📄 License

MIT License - see LICENSE file for details.

---

**Agent DJ Radio Sprint 2** - Built with ❤️ for AI-powered music experiences