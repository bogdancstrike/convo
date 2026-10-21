-- Append-only, hash-chained audit of administrative actions (ADM-01). Each row's hash covers the
-- previous hash, so rewriting or deleting earlier rows is detectable from any exported chain head.
CREATE TABLE admin_audit (
    seq        bigint      PRIMARY KEY,
    at         timestamptz NOT NULL,
    actor      text        NOT NULL,
    action     text        NOT NULL,
    target     text        NOT NULL,
    reason     text        NOT NULL,
    prev_hash  bytea       NOT NULL,
    hash       bytea       NOT NULL
);
