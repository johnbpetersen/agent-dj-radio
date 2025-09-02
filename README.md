# 🎵 Agent DJ Radio - Sprint 2 MVP

A real-time AI-generated music station where users pay to queue short songs that play for everyone. Now featuring real ElevenLabs AI music generation, x402 Lightning payments, and instant updates via Supabase Realtime.

## 🚀 Features

### Core Features
- **Single Station**: One shared radio station for all users
- **Queue System**: Submit AI-generated song prompts (60/90/120 seconds)
- **Live Playback**: Real-time audio streaming with progress tracking
- **Reactions**: Love ❤️, Fire 🔥, or Skip ⏭️ tracks to build ratings
- **Smart Replays**: Highly-rated tracks automatically replay when queue is empty

### Sprint 2 Additions ⭐
- **Real AI Music**: ElevenLabs Music API integration with 3-minute timeout
- **x402 Payments**: Lightning Network payment challenges with 15-minute expiration
- **Instant Updates**: Supabase Realtime for queue changes and station updates
- **Rate Limiting**: 60-second cooldown per user submission
- **Feature Flags**: Toggle between mock/real integrations for gradual rollout
- **Concurrency Control**: Database locks prevent multiple workers processing same track

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
cp .env.example .env
```

Fill in your configuration:
```env
# Site Configuration
VITE_SITE_URL=http://localhost:5173

# Supabase (Required)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Feature Flags (Sprint 2)
ENABLE_X402=false              # Enable x402 Lightning payments
ENABLE_REAL_ELEVEN=false       # Enable real ElevenLabs generation

# ElevenLabs (Optional - for real AI music)
ELEVEN_API_KEY=your-elevenlabs-key
ELEVEN_BASE_URL=https://api.elevenlabs.io/v1
ELEVEN_MUSIC_MODEL_ID=your-model-id

# X402 Payments (Optional - for Lightning payments)
X402_ACCEPTED_ASSET=BTC
X402_CHAIN=mainnet
X402_RECEIVING_ADDRESS=your-lightning-address
```

### 3. Database Setup
Run the SQL schema in your Supabase dashboard:
```bash
# Copy contents of supabase/schema.sql into Supabase SQL editor
```

### 4. Add Sample Audio
Replace `public/sample-track.mp3` with an actual MP3 file, or use any audio file for testing.

### 5. Development
```bash
# Start development server
npm run dev

# Run tests
npm run test

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
- `POST /api/worker/generate` - Every minute for track processing
- `POST /api/station/advance` - Every minute for station progression

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
2. **Payment**: User pays Lightning invoice → Confirms payment via `/confirm`
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

### Vercel Deployment
1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy - cron jobs will automatically activate

### Production Checklist
- ✅ Database schema deployed via Supabase dashboard
- ✅ Environment variables configured (see table below)
- ✅ Supabase Storage bucket `tracks` created with public access
- ✅ Feature flags set appropriately for your deployment
- ✅ ElevenLabs account and API key (if using real generation)
- ✅ Lightning Network setup (if using x402 payments)

## 🚧 Next Steps (Sprint 3+)

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

## 📝 Environment Variables

### Required Variables
| Variable | Description |
|----------|-------------|
| `VITE_SITE_URL` | Frontend URL (e.g., `http://localhost:5173`) |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_URL` | Supabase URL for API functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for API functions |

### Feature Flags (Sprint 2)
| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_X402` | Enable x402 Lightning payments | `false` |
| `ENABLE_REAL_ELEVEN` | Enable real ElevenLabs generation | `false` |

### Optional Services
| Variable | Description | Required For |
|----------|-------------|--------------|
| `ELEVEN_API_KEY` | ElevenLabs API key | Real AI music |
| `ELEVEN_BASE_URL` | ElevenLabs base URL | Real AI music |
| `ELEVEN_MUSIC_MODEL_ID` | ElevenLabs music model | Real AI music |
| `X402_ACCEPTED_ASSET` | Payment asset (e.g., BTC) | Lightning payments |
| `X402_CHAIN` | Blockchain network | Lightning payments |
| `X402_RECEIVING_ADDRESS` | Your Lightning address | Lightning payments |

## 🤝 Contributing

1. Run tests: `npm test`
2. Check types: `npm run typecheck`
3. Follow existing code style
4. Update tests for new features

## 📄 License

MIT License - see LICENSE file for details.

---

**Agent DJ Radio Sprint 1** - Built with ❤️ for AI-powered music experiences