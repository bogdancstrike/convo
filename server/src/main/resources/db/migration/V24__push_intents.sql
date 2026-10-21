-- Durable wake intents (MSG-02, specs §15): committed in the same transaction as the envelopes,
-- claimed by polling workers under a lease, retried with backoff, then dead-lettered.
-- One pending intent per device and kind (later mail coalesces into it). No content, sender or
-- conversation is stored; the endpoint stays in push_endpoints.
CREATE TABLE push_intents (
    id            bigserial   PRIMARY KEY,
    account_id    uuid        NOT NULL,
    device_id     int         NOT NULL,
    urgent        boolean     NOT NULL,
    attempts      int         NOT NULL DEFAULT 0,
    due_at        timestamptz NOT NULL,
    leased_until  timestamptz,
    expires_at    timestamptz NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX push_intents_one_pending ON push_intents (account_id, device_id, urgent);
CREATE INDEX push_intents_due ON push_intents (due_at);

-- Sanitized outcomes of intents that could not be delivered (kept 24 h, then purged).
CREATE TABLE push_dead_letters (
    id          bigserial   PRIMARY KEY,
    account_id  uuid        NOT NULL,
    device_id   int         NOT NULL,
    urgent      boolean     NOT NULL,
    reason      text        NOT NULL CHECK (reason IN ('gave_up', 'expired', 'rejected')),
    attempts    int         NOT NULL,
    failed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_dead_letters_failed ON push_dead_letters (failed_at);

-- Durable per-device rate limit (survives restarts and spans replicas).
ALTER TABLE push_endpoints ADD COLUMN last_wake_at timestamptz, ADD COLUMN last_urgent_at timestamptz;
