# 🎵 Agent DJ Radio - Sprint 1 MVP

A real-time AI-generated music station where users pay to queue short songs that play for everyone. Built with Vite + React + TypeScript, Vercel Functions, and Supabase.

## 🚀 Features (Sprint 1)

- **Single Station**: One shared radio station for all users
- **Queue System**: Submit AI-generated song prompts (60/90/120 seconds)
- **Live Playback**: Real-time audio streaming with progress tracking
- **Reactions**: Love ❤️, Fire 🔥, or Skip ⏭️ tracks to build ratings
- **Smart Replays**: Highly-rated tracks automatically replay when queue is empty
- **Pricing**: Duration-based pricing with bulk discounts
- **Mock Generation**: Simulated AI audio generation for development

## 🛠 Tech Stack

**Frontend:**
- Vite + React 18 + TypeScript
- Tailwind CSS for styling
- 5-second polling for live updates

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

Fill in your Supabase credentials:
```env
VITE_SITE_URL=http://localhost:5173
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
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
- `POST /api/queue/submit` - Submit new track (auto-paid in Sprint 1)

### Worker Endpoints  
- `POST /api/worker/generate` - Mock AI generation (PAID → READY)

### Station Endpoints
- `GET /api/station/state` - Current playing track + queue
- `POST /api/station/advance` - Advance to next track

### Reactions Endpoint
- `POST /api/reactions` - Add reaction and update rating

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
1. **Submit**: User submits prompt → Creates PAID track
2. **Generate**: Worker processes PAID → READY with audio URL
3. **Play**: Station advances READY → PLAYING → DONE
4. **React**: Users react to tracks, updating ratings
5. **Replay**: When queue empty, best DONE tracks become REPLAY tracks

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

## 🚧 Next Steps (Sprint 2+)

### Planned Features
- **x402 Payments**: Real Lightning Network payments
- **Real AI Generation**: ElevenLabs or similar integration
- **WebSocket Updates**: Replace polling with real-time subscriptions
- **User Authentication**: Proper login and user management
- **Multi-room Support**: Multiple stations/genres
- **Advanced Features**: Stems, HLS streaming, scheduled content

### Known Issues
- Audio sync may drift over time (acceptable for Sprint 1)
- No offline handling or retry logic
- Limited error recovery in UI components

## 📝 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_SITE_URL` | Frontend URL | ✅ |
| `VITE_SUPABASE_URL` | Supabase project URL | ✅ |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | ✅ |
| `SUPABASE_URL` | Supabase URL (API) | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (API) | ✅ |

## 🤝 Contributing

1. Run tests: `npm test`
2. Check types: `npm run typecheck`
3. Follow existing code style
4. Update tests for new features

## 📄 License

MIT License - see LICENSE file for details.

---

**Agent DJ Radio Sprint 1** - Built with ❤️ for AI-powered music experiences