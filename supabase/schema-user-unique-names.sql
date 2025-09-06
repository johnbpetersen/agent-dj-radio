-- Migration: Add unique constraint for display names (case-insensitive)
-- Sprint: User Integration Phase 1
-- Date: 2025-09-06

-- Add unique index on lower(display_name) to prevent duplicate display names
-- This enforces case-insensitive uniqueness without changing the schema
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_unique_idx 
ON public.users (lower(display_name));

-- Comment explaining the constraint
COMMENT ON INDEX users_display_name_unique_idx IS 'Ensures display names are unique (case-insensitive)';