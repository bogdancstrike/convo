-- =====================================================================================
-- Pending-removal gate (specs §4.7): a revoked device leaves the routing roster at once (it receives
-- nothing more) but its MLS leaf stays until a member commits the removal. While a row exists the
-- group accepts no application messages; the commit that removes the device deletes the row.
-- =====================================================================================

CREATE TABLE mls_group_pending_removals (
    group_id   bytea       NOT NULL REFERENCES mls_groups ON DELETE CASCADE,
    account_id uuid        NOT NULL,
    device_id  int         NOT NULL,
    revoked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, account_id, device_id)
);
