-- Migration 011: Identity System for Discord Unlink/Relink
-- Adds ephemeral_display_name to preserve original name during Discord link/unlink cycles

-- ============================================================================
-- 1. Add ephemeral_display_name column to users
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS ephemeral_display_name TEXT;

COMMENT ON COLUMN users.ephemeral_display_name IS 'Original ephemeral fun name (preserved during Discord link/unlink)';

-- Backfill existing users: set ephemeral_display_name = display_name for all ephemeral users
UPDATE users
SET ephemeral_display_name = display_name
WHERE ephemeral = true AND ephemeral_display_name IS NULL;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
