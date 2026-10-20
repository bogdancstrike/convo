-- User-requested minute precision for opt-in last seen. No activity timeline is retained.
ALTER TABLE accounts ADD COLUMN shared_last_seen_at timestamptz;
-- Do not fabricate midnight timestamps from the previous day-only value. The next visible
-- heartbeat initializes the timestamp; a hidden account always returns null from the API.
