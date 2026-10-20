-- =====================================================================================
-- identity module: accounts, devices, enrollment, prekeys, request replay protection.
-- Owner: com.enclave.identity. No other module may read or write these tables directly.
-- Only public keys and public metadata are stored; private key material never reaches the server.
-- =====================================================================================

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE accounts (
    account_id          uuid PRIMARY KEY,
    oidc_issuer         text        NOT NULL,
    oidc_subject        text        NOT NULL,
    username            citext      NOT NULL UNIQUE,
    next_device_id      bigint      NOT NULL DEFAULT 1 CHECK (next_device_id BETWEEN 1 AND 2147483648),
    device_list_version bigint      NOT NULL DEFAULT 0,
    identity_key        bytea,                      -- account IK (public); set at first registration
    status              text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE devices (
    account_id            uuid        NOT NULL REFERENCES accounts ON DELETE CASCADE,
    device_id             int         NOT NULL CHECK (device_id > 0),
    registration_id       int         NOT NULL CHECK (registration_id BETWEEN 1 AND 16383),
    device_signing_key    bytea       NOT NULL,     -- SPKI public key used for request proofs
    device_key_profile    text        NOT NULL,     -- e.g. p256-ecdsa-sha256-v1
    device_key_generation bigint      NOT NULL DEFAULT 1 CHECK (device_key_generation > 0),
    name_enc              bytea,                    -- owner-encrypted device label
    platform              text        NOT NULL CHECK (platform IN ('android', 'ios', 'desktop', 'web')),
    created_at            timestamptz NOT NULL DEFAULT now(),
    last_seen_day         date,                     -- day granularity only (metadata minimization)
    revoked_at            timestamptz,
    PRIMARY KEY (account_id, device_id)
);
CREATE INDEX devices_active_idx ON devices (account_id) WHERE revoked_at IS NULL;

CREATE TABLE enrollment_reservations (
    reservation_id uuid PRIMARY KEY,
    account_id     uuid        NOT NULL REFERENCES accounts ON DELETE CASCADE,
    device_id      int         NOT NULL,
    purpose        text        NOT NULL CHECK (purpose IN ('primary', 'link')),
    challenge      bytea       NOT NULL,
    expires_at     timestamptz NOT NULL,
    consumed_at    timestamptz,
    -- digest of the accepted enrollment, so an idempotent retry returns the original result
    accepted_key   bytea,
    UNIQUE (account_id, device_id)
);

CREATE TABLE signed_prekeys (
    account_id uuid  NOT NULL,
    device_id  int   NOT NULL,
    key_id     int   NOT NULL,
    public_key bytea NOT NULL,
    signature  bytea NOT NULL,
    PRIMARY KEY (account_id, device_id),
    FOREIGN KEY (account_id, device_id) REFERENCES devices ON DELETE CASCADE
);

CREATE TABLE one_time_prekeys (
    account_id uuid  NOT NULL,
    device_id  int   NOT NULL,
    key_id     int   NOT NULL,
    public_key bytea NOT NULL,
    PRIMARY KEY (account_id, device_id, key_id),
    FOREIGN KEY (account_id, device_id) REFERENCES devices ON DELETE CASCADE
);

-- Single-use request IDs for device proof-of-possession requests (specs §4.2).
CREATE TABLE device_request_ids (
    account_id uuid        NOT NULL,
    device_id  int         NOT NULL,
    request_id text        NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, device_id, request_id)
);
CREATE INDEX device_request_ids_expiry_idx ON device_request_ids (expires_at);
