-- =====================================================================================
-- identity module: MLS KeyPackages (specs §6.9, §12.2). Single-use; consumed by claims.
-- =====================================================================================

CREATE TABLE mls_key_packages (
    account_id  uuid        NOT NULL,
    device_id   int         NOT NULL,
    kp_ref      bytea       NOT NULL,             -- client-computed MLS KeyPackageRef
    key_package bytea       NOT NULL,             -- encoded MLSMessage(KeyPackage), public
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, device_id, kp_ref),
    FOREIGN KEY (account_id, device_id) REFERENCES devices ON DELETE CASCADE
);
