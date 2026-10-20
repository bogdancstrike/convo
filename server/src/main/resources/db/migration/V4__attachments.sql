-- =====================================================================================
-- attachments module: encrypted attachment object registry (specs §7, §13).
-- No uploader/recipient columns (metadata minimization); expiry is time-based.
-- =====================================================================================

CREATE TABLE attachments (
    attachment_id uuid PRIMARY KEY,
    object_key    text        NOT NULL UNIQUE,
    size_bytes    bigint      NOT NULL CHECK (size_bytes > 0),
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL
);
CREATE INDEX attachments_expiry_idx ON attachments (expires_at);
