-- Opt-in account activity sharing. Store only the UTC day; no continuous presence timeline.
ALTER TABLE accounts ADD COLUMN share_last_seen boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN shared_last_seen_day date;
ALTER TABLE accounts ADD CONSTRAINT accounts_last_seen_private
    CHECK (share_last_seen OR shared_last_seen_day IS NULL);
