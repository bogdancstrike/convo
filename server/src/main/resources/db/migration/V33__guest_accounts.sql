-- =====================================================================================
-- Guest accounts (FR-EXT-01, FR-ADM-01): time-limited sign-in accounts created by an administrator.
-- Keyed by the IdP subject because the Convo account row appears only at first sign-in. At
-- `expires_at` the server disables the sign-in account and the Convo account (`expired_at` set).
-- =====================================================================================

CREATE TABLE account_guests (
    subject     text        PRIMARY KEY CHECK (char_length(subject) <= 255),
    expires_at  timestamptz NOT NULL,
    invited_by  text        NOT NULL CHECK (char_length(invited_by) <= 255),
    created_at  timestamptz NOT NULL DEFAULT now(),
    expired_at  timestamptz
);

CREATE INDEX account_guests_due ON account_guests (expires_at) WHERE expired_at IS NULL;
