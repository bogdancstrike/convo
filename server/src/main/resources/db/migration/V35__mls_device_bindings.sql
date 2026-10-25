-- =====================================================================================
-- MLS device bindings (GRP-01): each device's long-lived MLS signature public key, signed by the
-- account identity key (XEdDSA) over the deployment, device address and key. The server only
-- stores and serves them; members verify the signature against the account identity key they trust
-- and refuse group leaves whose signature key is not bound. Revoked devices are never served.
-- =====================================================================================

CREATE TABLE mls_device_bindings (
    account_id     uuid        NOT NULL,
    device_id      int         NOT NULL,
    signature_key  bytea       NOT NULL CHECK (octet_length(signature_key) = 32),
    binding        bytea       NOT NULL CHECK (octet_length(binding) = 64),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, device_id),
    FOREIGN KEY (account_id, device_id) REFERENCES devices (account_id, device_id) ON DELETE CASCADE
);
