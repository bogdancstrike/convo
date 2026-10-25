-- Member call links (AC-CALL-07): a link names a group, never grants access by itself. Only the
-- SHA-256 hash of the link token is stored; membership is checked when it is resolved and again
-- when a LiveKit join token is issued.
CREATE TABLE call_links (
    token_hash  bytea PRIMARY KEY,
    group_id    bytea NOT NULL,
    created_by  uuid NOT NULL,
    created_at  timestamptz NOT NULL,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz
);
CREATE INDEX call_links_group ON call_links (group_id);
