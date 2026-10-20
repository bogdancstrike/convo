-- =====================================================================================
-- identity module: device linking / provisioning sessions (specs §4.4, §27.1; task ID-02).
-- The server relays an end-to-end encrypted ProvisionMessage; it never sees the account
-- identity key. Only the SHA-256 of the single-use provisioning code is stored.
-- =====================================================================================

CREATE TABLE provisioning_sessions (
    provisioning_id  uuid PRIMARY KEY,
    account_id       uuid        NOT NULL REFERENCES accounts ON DELETE CASCADE,
    reservation_id   uuid        NOT NULL REFERENCES enrollment_reservations ON DELETE CASCADE,
    ephemeral_public bytea       NOT NULL,              -- new device's X25519 public key
    client_label     text        NOT NULL CHECK (char_length(client_label) <= 64),
    status           text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'approved', 'completed', 'cancelled')),
    code_hash        bytea,                             -- SHA-256 of the provisioning code
    approver_device  int,
    message_public   bytea,                             -- approver's X25519 ephemeral public key
    message          bytea,                             -- AES-GCM(iv || ciphertext) ProvisionMessage
    created_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL
);
CREATE INDEX provisioning_sessions_account_idx ON provisioning_sessions (account_id) WHERE status IN ('pending', 'approved');
