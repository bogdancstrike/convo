-- Server-issued single-use nonces for device proofs (PRIV-02, specs §4.2). Only SHA-256 hashes
-- are stored; a nonce is consumed atomically with the signature check.
CREATE TABLE device_nonces (
    account_id  uuid        NOT NULL,
    device_id   int         NOT NULL,
    nonce_hash  bytea       NOT NULL,
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, device_id, nonce_hash)
);
CREATE INDEX device_nonces_expiry ON device_nonces (expires_at);
