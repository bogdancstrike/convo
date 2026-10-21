-- Accounts banned from a group: join requests and adds are refused until an admin unbans them.
CREATE TABLE mls_group_bans (
    group_id   bytea       NOT NULL REFERENCES mls_groups ON DELETE CASCADE,
    account_id uuid        NOT NULL,
    banned_by  uuid        NOT NULL,
    banned_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, account_id)
);
