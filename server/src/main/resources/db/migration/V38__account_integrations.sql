-- =====================================================================================
-- Visible integration accounts (specs §30, FR-EXT-02, AC-INT-01/02): an administrator marks a
-- dedicated account as an archive or a bot. Clients show the mark wherever the account appears,
-- ask before adding it to a group and keep a banner in every chat it is part of, so no account
-- can read conversations invisibly. Set only through the audited admin API.
-- (Key column named integration_account so the directory subquery's unqualified account_id
-- resolves to the outer accounts row, aliased or not.)
-- =====================================================================================

CREATE TABLE account_integrations (
    integration_account uuid        PRIMARY KEY REFERENCES accounts ON DELETE CASCADE,
    kind                text        NOT NULL CHECK (kind IN ('archive', 'bot')),
    -- Disclosed to everyone in chats with it, e.g. "kept 7 years for regulatory archiving".
    retention           text        NOT NULL CHECK (length(retention) BETWEEN 1 AND 200),
    set_by              text        NOT NULL,
    set_at              timestamptz NOT NULL DEFAULT now()
);
