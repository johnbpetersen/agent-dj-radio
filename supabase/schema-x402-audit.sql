-- x402 Payment Audit Trail
-- Sprint 5: Comprehensive payment tracking and audit trail

-- Create audit event types
CREATE TYPE x402_event_type AS ENUM (
    'CHALLENGE_CREATED',
    'PAYMENT_SUBMITTED', 
    'VERIFICATION_STARTED',
    'VERIFICATION_SUCCESS',
    'VERIFICATION_FAILED',
    'PAYMENT_CONFIRMED',
    'PAYMENT_EXPIRED',
    'CHALLENGE_REBUILT'
);

-- x402 Payment Audit Trail table
CREATE TABLE x402_payment_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    event_type x402_event_type NOT NULL,
    
    -- Challenge data
    challenge_nonce TEXT,
    challenge_amount TEXT,
    challenge_asset TEXT,
    challenge_chain TEXT,
    challenge_expires_at TIMESTAMPTZ,
    
    -- Verification data
    payment_proof TEXT,
    transaction_hash TEXT,
    block_number BIGINT,
    verification_attempts INTEGER DEFAULT 1,
    verification_duration_ms INTEGER,
    
    -- Context and correlation
    correlation_id TEXT,
    user_agent TEXT,
    ip_address TEXT,
    error_message TEXT,
    
    -- Additional metadata
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for audit trail queries
CREATE INDEX idx_x402_audit_track_id ON x402_payment_audit(track_id);
CREATE INDEX idx_x402_audit_event_type ON x402_payment_audit(event_type);
CREATE INDEX idx_x402_audit_correlation_id ON x402_payment_audit(correlation_id);
CREATE INDEX idx_x402_audit_created_at ON x402_payment_audit(created_at DESC);
CREATE INDEX idx_x402_audit_transaction_hash ON x402_payment_audit(transaction_hash) WHERE transaction_hash IS NOT NULL;

-- Composite index for track event timeline
CREATE INDEX idx_x402_audit_track_timeline ON x402_payment_audit(track_id, created_at DESC);

-- Function to get complete payment audit trail for a track
CREATE OR REPLACE FUNCTION get_payment_audit_trail(p_track_id UUID)
RETURNS TABLE(
    event_type x402_event_type,
    challenge_nonce TEXT,
    transaction_hash TEXT,
    verification_attempts INTEGER,
    error_message TEXT,
    correlation_id TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.event_type,
        a.challenge_nonce,
        a.transaction_hash,
        a.verification_attempts,
        a.error_message,
        a.correlation_id,
        a.created_at
    FROM x402_payment_audit a
    WHERE a.track_id = p_track_id
    ORDER BY a.created_at ASC;
END;
$$;

-- Function to get payment statistics
CREATE OR REPLACE FUNCTION get_payment_statistics(p_start_date TIMESTAMPTZ DEFAULT now() - interval '24 hours')
RETURNS TABLE(
    total_challenges INTEGER,
    total_submissions INTEGER,
    successful_verifications INTEGER,
    failed_verifications INTEGER,
    expired_challenges INTEGER,
    success_rate NUMERIC(5,2),
    avg_verification_time_ms NUMERIC(10,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) FILTER (WHERE event_type = 'CHALLENGE_CREATED')::INTEGER as total_challenges,
        COUNT(*) FILTER (WHERE event_type = 'PAYMENT_SUBMITTED')::INTEGER as total_submissions,
        COUNT(*) FILTER (WHERE event_type = 'VERIFICATION_SUCCESS')::INTEGER as successful_verifications,
        COUNT(*) FILTER (WHERE event_type = 'VERIFICATION_FAILED')::INTEGER as failed_verifications,
        COUNT(*) FILTER (WHERE event_type = 'PAYMENT_EXPIRED')::INTEGER as expired_challenges,
        CASE 
            WHEN COUNT(*) FILTER (WHERE event_type IN ('VERIFICATION_SUCCESS', 'VERIFICATION_FAILED')) > 0
            THEN ROUND(
                (COUNT(*) FILTER (WHERE event_type = 'VERIFICATION_SUCCESS')::NUMERIC / 
                 COUNT(*) FILTER (WHERE event_type IN ('VERIFICATION_SUCCESS', 'VERIFICATION_FAILED'))::NUMERIC) * 100, 
                2
            )
            ELSE 0
        END as success_rate,
        AVG(verification_duration_ms) FILTER (WHERE verification_duration_ms IS NOT NULL) as avg_verification_time_ms
    FROM x402_payment_audit
    WHERE created_at >= p_start_date;
END;
$$;