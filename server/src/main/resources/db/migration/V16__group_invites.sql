-- Invite links (only a SHA-256 of the token is stored) and pending join requests.
CREATE TABLE mls_group_invites (
    token_hash  bytea       PRIMARY KEY,
    group_id    bytea       NOT NULL REFERENCES mls_groups ON DELETE CASCADE,
    created_by  uuid        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);
CREATE INDEX mls_group_invites_group_idx ON mls_group_invites (group_id);

CREATE TABLE mls_group_join_requests (
    group_id     bytea       NOT NULL REFERENCES mls_groups ON DELETE CASCADE,
    account_id   uuid        NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, account_id)
);
