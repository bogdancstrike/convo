-- Members who left a group but whose MLS leaves are not removed yet ("pending removal").
-- They are no longer in the ACL and receive no further group ciphertext; any remaining member
-- may commit their MLS Remove, after which the row is deleted.
CREATE TABLE mls_group_departures (
    group_id   bytea       NOT NULL REFERENCES mls_groups ON DELETE CASCADE,
    account_id uuid        NOT NULL,
    left_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, account_id)
);
