-- Migration: Create helper functions for ephemeral user cleanup
-- Used by the cleanup worker to maintain data hygiene

-- Function to clean up expired presence records
CREATE OR REPLACE FUNCTION cleanup_expired_presence()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete presence records older than 5 minutes
  DELETE FROM presence 
  WHERE last_seen_at < now() - interval '5 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up ephemeral users
CREATE OR REPLACE FUNCTION cleanup_ephemeral_users()
RETURNS TABLE(deleted_count INTEGER, anonymized_count INTEGER) AS $$
DECLARE
  deleted INTEGER := 0;
  anonymized INTEGER := 0;
BEGIN
  -- Delete ephemeral users with no tracks, no chat messages, and inactive for 24+ hours
  DELETE FROM users 
  WHERE ephemeral = true 
    AND last_seen_at < now() - interval '24 hours'
    AND id NOT IN (SELECT DISTINCT user_id FROM tracks WHERE user_id IS NOT NULL)
    AND id NOT IN (SELECT DISTINCT user_id FROM chat_messages WHERE user_id IS NOT NULL);
  
  GET DIAGNOSTICS deleted = ROW_COUNT;
  
  -- Anonymize ephemeral users with tracks but inactive for 24+ hours
  UPDATE users 
  SET 
    display_name = 'anon_' || left(id::text, 8),
    bio = null
  WHERE ephemeral = true 
    AND last_seen_at < now() - interval '24 hours'
    AND display_name NOT LIKE 'anon_%'
    AND (
      id IN (SELECT DISTINCT user_id FROM tracks WHERE user_id IS NOT NULL)
      OR id IN (SELECT DISTINCT user_id FROM chat_messages WHERE user_id IS NOT NULL)
    );
  
  GET DIAGNOSTICS anonymized = ROW_COUNT;
  
  RETURN QUERY SELECT deleted, anonymized;
END;
$$ LANGUAGE plpgsql;

-- Comments for clarity
COMMENT ON FUNCTION cleanup_expired_presence() IS 'Removes presence records older than 5 minutes';
COMMENT ON FUNCTION cleanup_ephemeral_users() IS 'Deletes or anonymizes ephemeral users based on activity and content';