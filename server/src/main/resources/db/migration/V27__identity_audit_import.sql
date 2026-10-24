-- Durable exactly-once import into the hash chain; cursor and entries commit together.
CREATE TABLE identity_audit_cursor (
    source text PRIMARY KEY,
    through_millis bigint NOT NULL DEFAULT 0
);
INSERT INTO identity_audit_cursor(source) VALUES ('keycloak');
CREATE TABLE identity_audit_import (
    event_id text PRIMARY KEY,
    source_time timestamptz NOT NULL
);
CREATE INDEX identity_audit_import_time ON identity_audit_import(source_time);
CREATE INDEX admin_audit_at ON admin_audit(at);
CREATE INDEX admin_audit_action ON admin_audit(action);
