-- =====================================================================================
-- Organization policy (specs §19.1, AC-ADM-02): versioned policy documents signed with the server's
-- Ed25519 policy key. `document` is the exact signed JSON text (clients verify these bytes, so no
-- canonicalization is needed). Versions only grow; edits name the version they replace.
-- `policy_signing_key` holds a generated key only when `enclave.policy.signing-key` is not set.
-- =====================================================================================

CREATE TABLE org_policies (
    version     integer     PRIMARY KEY CHECK (version >= 1),
    document    text        NOT NULL CHECK (char_length(document) <= 16384),
    signature   bytea       NOT NULL,
    key_id      text        NOT NULL,
    created_by  text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_signing_key (
    id          integer     PRIMARY KEY CHECK (id = 1),
    private_key bytea       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
