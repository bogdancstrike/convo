-- =====================================================================================
-- Key transparency (specs §19.4, TRUST-01): an append-only verifiable log (RFC 9162 Merkle tree)
-- of each account's identity key and device list. Leaves are appended in the same transaction
-- as the device change; every append signs a new tree head; independent witnesses co-sign heads
-- after checking the log only grew. Only public keys and hashes are stored.
-- =====================================================================================

CREATE TABLE kt_leaves (
    idx                 bigint      PRIMARY KEY,
    account_id          uuid        NOT NULL,
    identity_key        bytea       NOT NULL,
    device_list_version bigint      NOT NULL,
    device_hash         bytea       NOT NULL,
    leaf_hash           bytea       NOT NULL,
    appended_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kt_leaves_account ON kt_leaves (account_id, idx DESC);

-- Signed tree heads, one per size. Signature over CONVO-KT-HEAD-V1 (see transparency/docs.md).
CREATE TABLE kt_heads (
    size       bigint      PRIMARY KEY,
    root       bytea       NOT NULL,
    signed_at  timestamptz NOT NULL,
    signature  bytea       NOT NULL
);

-- Witness co-signatures of heads (CONVO-KT-COSIGN-V1 over the head bytes).
CREATE TABLE kt_cosignatures (
    size        bigint      NOT NULL REFERENCES kt_heads ON DELETE CASCADE,
    witness_id  text        NOT NULL,
    signature   bytea       NOT NULL,
    cosigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (size, witness_id)
);

-- Development fallback for the log signing key (production sets enclave.kt.signing-key).
CREATE TABLE kt_signing_key (
    id          int   PRIMARY KEY CHECK (id = 1),
    private_key bytea NOT NULL
);
