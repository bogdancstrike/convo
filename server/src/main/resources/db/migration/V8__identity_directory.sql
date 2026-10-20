-- =====================================================================================
-- identity module: organization directory attributes (ADR-0002). Display name and phone come from
-- the organization IdP (Keycloak claims `name`, `phone_number`), not from E2EE profiles.
-- `search_text` is the diacritic-folded, lower-case display name; `phone_digits` the digits only.
-- =====================================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE accounts
    ADD COLUMN display_name text CHECK (char_length(display_name) <= 128),
    ADD COLUMN phone        text CHECK (char_length(phone) <= 32),
    ADD COLUMN phone_digits text CHECK (phone_digits ~ '^[0-9]{0,20}$'),
    ADD COLUMN search_text  text;

CREATE INDEX accounts_search_text_trgm ON accounts USING gin (search_text gin_trgm_ops);
CREATE INDEX accounts_phone_digits_trgm ON accounts USING gin (phone_digits gin_trgm_ops);
