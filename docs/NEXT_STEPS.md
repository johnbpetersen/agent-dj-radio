# Next Steps & Roadmap

## Sprint 8 Priorities

### 1. Real Payment Integration ⚡ **HIGH**

**Goal:** Enable end-to-end Base Sepolia USDC payments

**Tasks:**
- [ ] Set up funded Base Sepolia test wallet
- [ ] Configure production X402_API_KEY with Coinbase CDP
- [ ] End-to-end test with real USDC transactions
- [ ] Document real payment setup in README
- [ ] Add payment verification error handling

**Definition of Done:**
- Real Base Sepolia USDC payment completes full flow
- Payment verification succeeds with actual transaction hash  
- Error states gracefully handled (insufficient funds, expired challenges)

**Risk:** CDP API changes, network congestion affecting verification

---

### 2. Payment UX Polish 🎨 **HIGH**

**Goal:** Production-ready 402 payment modal experience

**Tasks:**
- [ ] Add countdown timer for challenge expiration
- [ ] Improve payment modal copy and visual design
- [ ] Add retry mechanism for failed confirmations  
- [ ] Show payment status feedback (processing, success, error)
- [ ] Add "Try Again" button for expired challenges

**Definition of Done:**
- User understands payment flow without confusion
- Clear feedback on payment status at all times
- Graceful handling of edge cases (expiry, network errors)

---

### 3. Provider-Safe Prompt Rewrite 🛡️ **MEDIUM**

**Goal:** Auto-fix ElevenLabs ToS violations with smart retry

**Current State:** Worker fails track on "bad_prompt", falls back to mock audio

**Tasks:**
- [ ] Detect provider suggestions in error responses
- [ ] Implement prompt rewrite using instrumental-only templates
- [ ] Add single retry with safe prompt before mock fallback
- [ ] Add telemetry for prompt rewrite frequency
- [ ] Surface rewrite notices in UI ("We adjusted your prompt...")

**Definition of Done:**
- 90% reduction in ElevenLabs ToS failures
- User sees transparent notice when prompt adjusted
- Fallback to mock only after retry fails

**Examples:**
- "Sad love song" → "Melancholy instrumental piece"  
- "Eminem rap beat" → "Upbeat instrumental hip-hop"

---

### 4. Admin Dashboard Updates 📊 **MEDIUM** 

**Goal:** Basic observability for payment and generation pipeline

**Tasks:**
- [ ] Payment flow health metrics (success rate, avg confirmation time)
- [ ] Generation pipeline latency tracking (PAID → READY duration)
- [ ] Recent payments list with drill-through to audit logs
- [ ] Worker success rates and failure categories
- [ ] Top user activity and submission patterns

**Definition of Done:**
- Admin can diagnose payment issues in <2 minutes
- Generation bottlenecks visible in dashboard
- Historical trends available for capacity planning

---

## Sprint 9 Candidates

### Challenge Expiry UX
- Real-time countdown in payment modal
- Auto-refresh challenges when expired
- Graceful degradation for network issues

### Wallet Linking (Optional)
- Associate user accounts with wallet addresses
- Payment history and receipts
- Prefill payment UI with linked wallets

### E2E Test Suite
- Automated mock payment flow testing
- Integration test for real payment path (staging)
- Performance regression testing for generation pipeline

### Advanced Error Budgets
- Log-based alerting on verification failure rates
- SLA monitoring for generation latency
- Automatic fallback mode activation

## Long-term Vision (Sprint 10+)

### Multi-Asset Support
- Support ETH, other Base tokens beyond USDC
- Dynamic pricing based on asset volatility
- Cross-chain payment routing

### Advanced Audio Features  
- Stem separation and remixing
- Genre-specific model selection
- User audio uploads as source material

### Social Features
- Track likes and sharing
- Collaborative playlists
- User-generated challenges and contests

## Technical Debt & Maintenance

### Performance Optimization
- Database query optimization for large track volumes
- CDN integration for audio streaming
- Realtime connection pooling and scaling

### Security Hardening
- Rate limiting enhancements
- Payment fraud detection
- Enhanced audit logging and compliance

### Developer Experience
- Local development Docker setup
- API documentation generation
- Automated deployment pipeline

---

## Decision Framework

**Prioritization Criteria:**
1. **User Impact** - Does this directly improve user experience?
2. **Business Value** - Does this enable new revenue or reduce costs?
3. **Technical Risk** - What's the complexity vs benefit ratio?
4. **Dependencies** - Are external services or teams required?

**Sprint Planning Process:**
1. Review current user feedback and pain points
2. Assess technical debt impact on velocity  
3. Evaluate external dependencies (CDP, ElevenLabs changes)
4. Commit to realistic scope with buffer for unknowns

**Success Metrics:**
- Payment success rate >95%
- Audio generation latency <30s average
- User completion rate (submit → play) >80%
- System uptime >99.5%