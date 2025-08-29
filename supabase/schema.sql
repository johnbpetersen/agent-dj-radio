-- Agent DJ Radio Database Schema
-- Sprint 1: No RLS, basic constraints and enums

-- Create custom types
CREATE TYPE track_source AS ENUM ('GENERATED', 'REPLAY');
CREATE TYPE track_status AS ENUM ('PAID', 'GENERATING', 'READY', 'PLAYING', 'DONE', 'FAILED', 'ARCHIVED');
CREATE TYPE reaction_kind AS ENUM ('LOVE', 'FIRE', 'SKIP');

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    banned BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Tracks table
CREATE TABLE tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    duration_seconds INTEGER DEFAULT 120,
    source track_source NOT NULL,
    status track_status NOT NULL,
    price_usd NUMERIC(10,2) DEFAULT 0,
    x402_payment_tx JSONB,
    eleven_request_id TEXT,
    audio_url TEXT,
    rating_score NUMERIC(10,2) DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    last_played_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT valid_duration CHECK (duration_seconds IN (60, 90, 120)),
    CONSTRAINT valid_price CHECK (price_usd >= 0),
    CONSTRAINT valid_rating_score CHECK (rating_score >= 0),
    CONSTRAINT valid_rating_count CHECK (rating_count >= 0)
);

-- Reactions table
CREATE TABLE reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind reaction_kind NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- One reaction per user per track
    UNIQUE(track_id, user_id)
);

-- Station state table (singleton)
CREATE TABLE station_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    current_track_id UUID REFERENCES tracks(id) ON DELETE SET NULL,
    current_started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Ensure only one row exists
    CONSTRAINT singleton_station_state CHECK (id = 1)
);

-- Insert initial station state
INSERT INTO station_state (id) VALUES (1);

-- Indexes for performance
CREATE INDEX idx_tracks_user_id ON tracks(user_id);
CREATE INDEX idx_tracks_status ON tracks(status);
CREATE INDEX idx_tracks_source ON tracks(source);
CREATE INDEX idx_tracks_rating_score ON tracks(rating_score DESC);
CREATE INDEX idx_tracks_last_played_at ON tracks(last_played_at);
CREATE INDEX idx_tracks_created_at ON tracks(created_at);
CREATE INDEX idx_reactions_track_id ON reactions(track_id);
CREATE INDEX idx_reactions_user_id ON reactions(user_id);

-- Library index for track selection queries
CREATE INDEX idx_tracks_library ON tracks(status, rating_score DESC, last_played_at ASC) 
WHERE status IN ('READY', 'DONE');