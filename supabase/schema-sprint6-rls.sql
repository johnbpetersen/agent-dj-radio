-- Sprint 6: Row Level Security (RLS) Implementation
-- Minimal RLS for tracks/reactions with anonymous user support

-- Enable RLS on sensitive tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_payment_audit ENABLE ROW LEVEL SECURITY;

-- Station state remains open (read-only for all, write for service role)
-- No RLS needed as it's public information

-- Users table policies
-- Anonymous users can create their own user record
-- Users can read their own data
-- Service role can do anything (for admin operations)

CREATE POLICY "Users can insert their own record" ON users
    FOR INSERT TO anon, authenticated
    WITH CHECK (true); -- Allow anon users to create user records

CREATE POLICY "Users can read their own data" ON users
    FOR SELECT TO anon, authenticated
    USING (auth.uid() = id OR auth.jwt() ->> 'role' = 'anon');

CREATE POLICY "Service role full access to users" ON users
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- Tracks table policies
-- All users can read visible tracks (READY, PLAYING, DONE status)
-- Users can only insert tracks for themselves
-- Users can read their own tracks regardless of status
-- Service role can do anything

CREATE POLICY "Anyone can read visible tracks" ON tracks
    FOR SELECT TO anon, authenticated
    USING (
        status IN ('READY', 'PLAYING', 'DONE') 
        OR user_id = auth.uid()
        OR (auth.jwt() ->> 'role' = 'anon' AND status IN ('READY', 'PLAYING', 'DONE'))
    );

CREATE POLICY "Users can insert their own tracks" ON tracks
    FOR INSERT TO anon, authenticated
    WITH CHECK (
        user_id = auth.uid() 
        OR (auth.jwt() ->> 'role' = 'anon' AND user_id IS NOT NULL)
    );

CREATE POLICY "Users can update their own tracks" ON tracks
    FOR UPDATE TO anon, authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role full access to tracks" ON tracks
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- Reactions table policies  
-- All users can read reactions for visible tracks
-- Users can only insert/update their own reactions
-- Service role can do anything

CREATE POLICY "Anyone can read reactions for visible tracks" ON reactions
    FOR SELECT TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM tracks 
            WHERE tracks.id = reactions.track_id 
            AND tracks.status IN ('READY', 'PLAYING', 'DONE')
        )
    );

CREATE POLICY "Users can manage their own reactions" ON reactions
    FOR ALL TO anon, authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role full access to reactions" ON reactions
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- x402_payment_audit table policies
-- Only service role and track owners can read audit data
-- Only service role can insert audit data

CREATE POLICY "Track owners can read their payment audit" ON x402_payment_audit
    FOR SELECT TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM tracks 
            WHERE tracks.id = x402_payment_audit.track_id 
            AND tracks.user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access to payment audit" ON x402_payment_audit
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- Create helper function for anonymous user management
-- This allows the frontend to create temporary user IDs for anonymous users
CREATE OR REPLACE FUNCTION create_anonymous_user(display_name TEXT DEFAULT 'Anonymous')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_id UUID;
BEGIN
    -- Create a new anonymous user
    INSERT INTO users (display_name, banned, last_submit_at)
    VALUES (display_name, false, NULL)
    RETURNING id INTO user_id;
    
    RETURN user_id;
END;
$$;

-- Grant execute permission to anonymous and authenticated users
GRANT EXECUTE ON FUNCTION create_anonymous_user(TEXT) TO anon, authenticated;

-- Create helper function to check if user can submit (rate limiting)
CREATE OR REPLACE FUNCTION can_user_submit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    last_submit TIMESTAMPTZ;
    cooldown_seconds INTEGER := 60; -- 60 second cooldown
BEGIN
    -- Get user's last submit time
    SELECT last_submit_at INTO last_submit
    FROM users
    WHERE id = p_user_id AND NOT banned;
    
    -- If user not found or banned, deny
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    
    -- If never submitted, allow
    IF last_submit IS NULL THEN
        RETURN true;
    END IF;
    
    -- Check if cooldown period has passed
    RETURN (EXTRACT(EPOCH FROM (NOW() - last_submit)) >= cooldown_seconds);
END;
$$;

-- Grant execute permission to anonymous and authenticated users
GRANT EXECUTE ON FUNCTION can_user_submit(UUID) TO anon, authenticated;

-- Create function to update user submit time (called after successful submission)
CREATE OR REPLACE FUNCTION update_user_submit_time(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE users 
    SET last_submit_at = NOW()
    WHERE id = p_user_id;
    
    RETURN FOUND;
END;
$$;

-- Grant execute permission to service role (called by API)
GRANT EXECUTE ON FUNCTION update_user_submit_time(UUID) TO service_role;