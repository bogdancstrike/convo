-- Parent-removal delegation (specs §30.3): a linked group may accept that removal from the
-- community also removes the account from the group. Operations make each step visible.
ALTER TABLE community_group_links ADD COLUMN delegation boolean NOT NULL DEFAULT false;

CREATE TABLE community_membership_ops (
    community_id uuid        NOT NULL REFERENCES communities ON DELETE CASCADE,
    group_id     bytea       NOT NULL,
    account_id   uuid        NOT NULL,
    status       text        NOT NULL CHECK (status IN ('pending', 'completed', 'blocked')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, group_id, account_id)
);
