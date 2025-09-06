# Architecture Overview

Agent DJ Radio is a real-time music generation platform with integrated payment processing.

## System Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Web UI
    participant Submit as /api/queue/submit
    participant MockProof as /api/x402/mock-proof
    participant Confirm as /api/queue/confirm
    participant Worker as /api/worker/generate
    participant ElevenLabs
    participant Storage as Supabase Storage
    participant Station as Station Cron

    User->>UI: Enter name & track prompt
    UI->>Submit: POST with user_id, prompt
    Submit-->>UI: 402 + X-PAYMENT header
    
    Note over UI: Payment Modal Shows
    User->>MockProof: Generate test proof (dev)
    MockProof-->>User: payment_proof
    
    User->>Confirm: POST track_id + proof
    Confirm->>Confirm: Verify using stored challenge
    Confirm->>Worker: Trigger generation (track_id)
    Confirm-->>UI: 200 + track PAID
    
    Worker->>ElevenLabs: Generate audio (or mock)
    ElevenLabs-->>Worker: Audio file
    Worker->>Storage: Upload with MIME type
    Worker->>Worker: Mark track READY
    
    Station->>Station: Advance to next READY track
    Station-->>UI: Realtime broadcast update
```

## Component Architecture

```mermaid
graph TB
    subgraph "Web Client"
        UI[React UI]
        UserHook[useUser Hook]
        Form[SubmitForm Component]
    end
    
    subgraph "API Layer"
        Submit[queue/submit]
        Confirm[queue/confirm] 
        Worker[worker/generate]
        Users[users endpoints]
        MockProof[x402/mock-proof]
    end
    
    subgraph "Payment Provider"
        CDP[Coinbase CDP]
        Mock[Mock Verifier]
    end
    
    subgraph "Audio Generation"
        Eleven[ElevenLabs API]
        MockAudio[Mock Generator]
    end
    
    subgraph "Supabase"
        DB[(Database)]
        Storage[(Audio Storage)]
        Realtime[Realtime Updates]
    end

    UI --> Form
    Form --> UserHook
    Form --> Submit
    Submit --> Confirm
    Confirm --> Worker
    
    Submit -.->|402 + challenge| CDP
    Submit -.->|dev mode| Mock
    
    Worker --> Eleven
    Worker -.->|fallback| MockAudio
    Worker --> Storage
    
    Worker --> DB
    DB --> Realtime
    Realtime --> UI
```

## Data Flow

1. **User Creation**: Persistent identity via localStorage + database lookup
2. **Payment Challenge**: Submit creates PENDING_PAYMENT track with x402 challenge
3. **Proof Verification**: Confirm validates against stored challenge, marks PAID
4. **Generation Pipeline**: Worker claims PAID track, generates audio, uploads to storage
5. **Station Playback**: Cron advances through READY tracks with realtime UI updates

## Key Design Decisions

**Payment-First Architecture**: Tracks created in PENDING_PAYMENT state, only advance after verification
**Idempotent Operations**: Confirm endpoint safe to retry, worker handles concurrent claims
**Instrumental Enforcement**: Prompts filtered for ElevenLabs ToS compliance
**Mock-First Development**: All external services have mock implementations for testing