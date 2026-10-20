-- =====================================================================================
-- messaging module: idempotent submissions, per-device mailboxes, WebSocket tickets.
-- Owner: com.enclave.messaging. Payloads are opaque end-to-end ciphertext.
-- =====================================================================================

CREATE TABLE submissions (
    origin_account uuid        NOT NULL,
    origin_device  int         NOT NULL,
    submission_id  bytea       NOT NULL CHECK (octet_length(submission_id) = 16),
    digest         bytea       NOT NULL,             -- SHA-256 of canonical request
    result         jsonb       NOT NULL,             -- original SendResult (no plaintext)
    created_at     timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,
    PRIMARY KEY (origin_account, origin_device, submission_id)
);
CREATE INDEX submissions_expiry_idx ON submissions (expires_at);

-- Mailbox. Launch profile partitions by server_ts (specs §13); the walking slice keeps one table
-- with per-row expiry and the same drain index so partitioning is a pure storage migration.
CREATE TABLE envelopes (
    account_id     uuid        NOT NULL,
    device_id      int         NOT NULL,
    guid           uuid        NOT NULL,
    server_ts      timestamptz NOT NULL DEFAULT clock_timestamp(),
    type           smallint    NOT NULL,
    source_account uuid,
    source_device  int,
    urgent         boolean     NOT NULL DEFAULT false,
    expires_at     timestamptz NOT NULL,
    content        bytea       NOT NULL,
    PRIMARY KEY (account_id, device_id, guid)
);
CREATE INDEX envelopes_drain_idx ON envelopes (account_id, device_id, server_ts, guid);
CREATE INDEX envelopes_expiry_idx ON envelopes (expires_at);

-- One-use browser WebSocket tickets (specs §9.1): only the SHA-256 of the ticket is stored.
CREATE TABLE ws_tickets (
    ticket_hash bytea PRIMARY KEY,
    account_id  uuid        NOT NULL,
    device_id   int         NOT NULL,
    origin      text,
    expires_at  timestamptz NOT NULL
);
