-- =====================================================================================
-- messaging module: group routing metadata on envelopes (specs §9.2 Envelope.group_id/epoch/
-- group_seq). Needed by clients to order MLS handshake and application processing.
-- =====================================================================================

ALTER TABLE envelopes
    ADD COLUMN group_id  bytea,
    ADD COLUMN epoch     bigint,
    ADD COLUMN group_seq bigint;
