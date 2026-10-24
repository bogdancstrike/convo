-- Security operations retain all history; cleanup belongs to external maintenance.
CREATE TABLE admin_session_observation (
    session_id text PRIMARY KEY,
    subject_id text NOT NULL,
    browser text NOT NULL,
    operating_system text NOT NULL,
    observed_at timestamptz NOT NULL
);
CREATE TABLE admin_alert_rule (
    id text PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT true,
    severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    threshold integer NOT NULL CHECK (threshold BETWEEN 1 AND 1000),
    window_minutes integer NOT NULL CHECK (window_minutes BETWEEN 1 AND 1440),
    notify boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL DEFAULT 'system'
);
INSERT INTO admin_alert_rule(id, severity, threshold, window_minutes) VALUES
    ('failed-logins', 'high', 5, 5),
    ('device-burst', 'medium', 3, 10),
    ('role-grant', 'high', 1, 1),
    ('audit-sync', 'critical', 1, 2);
CREATE TABLE admin_security_alert (
    id uuid PRIMARY KEY,
    dedup_key text NOT NULL UNIQUE,
    rule_id text NOT NULL REFERENCES admin_alert_rule(id),
    severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    title text NOT NULL,
    subject text NOT NULL,
    subject_name text NOT NULL,
    detail text NOT NULL,
    occurrences bigint NOT NULL,
    first_seq bigint,
    last_seq bigint,
    first_seen timestamptz NOT NULL,
    last_seen timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_security_alert_created ON admin_security_alert(created_at DESC, id);
CREATE INDEX admin_security_alert_status ON admin_security_alert(status, severity);
CREATE TABLE admin_alert_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    alert_id uuid NOT NULL REFERENCES admin_security_alert(id),
    at timestamptz NOT NULL,
    actor text NOT NULL,
    status text NOT NULL,
    reason text NOT NULL
);
CREATE TABLE admin_alert_cursor (
    id integer PRIMARY KEY CHECK (id = 1),
    through_seq bigint NOT NULL,
    last_success timestamptz,
    outage_key text
);
-- Detect new activity, rather than notifying on the entire retained audit history.
INSERT INTO admin_alert_cursor(id, through_seq) SELECT 1, coalesce(max(seq), 0) FROM admin_audit;
CREATE INDEX admin_audit_detection ON admin_audit(action, at, seq);
