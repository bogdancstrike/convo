-- =====================================================================================
-- groups module: MLS Delivery Service state (specs §6.3–6.5, §13, §26.2 group_events).
-- The server orders commits per group and mirrors the account-level role ACL and the device
-- routing roster. Group names, descriptions and messages are end-to-end encrypted elsewhere.
-- =====================================================================================

CREATE TABLE mls_groups (
    group_id   bytea       PRIMARY KEY CHECK (octet_length(group_id) = 32),
    epoch      bigint      NOT NULL CHECK (epoch >= 0),
    next_seq   bigint      NOT NULL DEFAULT 1,
    status     text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mls_group_members (                 -- account-level ACL mirror
    group_id   bytea       NOT NULL REFERENCES mls_groups ON DELETE CASCADE,
    account_id uuid        NOT NULL,
    role       text        NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, account_id)
);
CREATE INDEX mls_group_members_account_idx ON mls_group_members (account_id);

CREATE TABLE mls_group_devices (                 -- device-level routing roster
    group_id   bytea NOT NULL REFERENCES mls_groups ON DELETE CASCADE,
    account_id uuid  NOT NULL,
    device_id  int   NOT NULL,
    PRIMARY KEY (group_id, account_id, device_id)
);
CREATE INDEX mls_group_devices_device_idx ON mls_group_devices (account_id, device_id);

CREATE TABLE mls_group_events (                  -- ordered accepted commits (catch-up window)
    group_id      bytea       NOT NULL REFERENCES mls_groups ON DELETE CASCADE,
    seq           bigint      NOT NULL,
    epoch         bigint      NOT NULL,          -- epoch the commit was created in
    submission_id bytea       NOT NULL,
    digest        bytea       NOT NULL,
    payload       bytea       NOT NULL,          -- encoded MLSMessage (public commit)
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, seq),
    UNIQUE (group_id, submission_id)
);

CREATE TABLE mls_group_submissions (             -- idempotency of application messages
    group_id      bytea       NOT NULL,
    origin_account uuid       NOT NULL,
    origin_device int         NOT NULL,
    submission_id bytea       NOT NULL CHECK (octet_length(submission_id) = 16),
    digest        bytea       NOT NULL,
    expires_at    timestamptz NOT NULL,
    PRIMARY KEY (group_id, origin_account, origin_device, submission_id)
);
CREATE INDEX mls_group_submissions_expiry_idx ON mls_group_submissions (expires_at);
