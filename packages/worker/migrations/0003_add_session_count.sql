-- Add session_count to track distinct conversation sessions (vs API request events)
ALTER TABLE daily_usage_breakdown ADD COLUMN session_count INTEGER NOT NULL DEFAULT 0;
