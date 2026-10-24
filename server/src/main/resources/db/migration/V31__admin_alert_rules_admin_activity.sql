-- Six additional server-visible detection rules over the admin audit stream.
-- Message content is end-to-end encrypted, so no rule can inspect attachments or links.
ALTER TABLE admin_alert_rule
    ADD COLUMN business_start_hour smallint CHECK (business_start_hour BETWEEN 0 AND 23),
    ADD COLUMN business_end_hour smallint CHECK (business_end_hour BETWEEN 1 AND 24),
    ADD COLUMN business_days text CHECK (business_days ~ '^[1-7](,[1-7])*$'),
    ADD CONSTRAINT admin_alert_rule_business_hours CHECK (
        (business_start_hour IS NULL AND business_end_hour IS NULL AND business_days IS NULL)
        OR (business_start_hour < business_end_hour AND business_days IS NOT NULL));
INSERT INTO admin_alert_rule(id, enabled, severity, threshold, window_minutes) VALUES
    ('audit-export', true, 'medium', 1, 1),
    ('bulk-device-unlink', true, 'high', 5, 10),
    ('bulk-account-disable', true, 'high', 3, 10),
    ('credential-reset-burst', true, 'medium', 5, 10),
    ('session-end-burst', true, 'medium', 10, 10);
-- Business hours differ per organization, so off-hours detection starts disabled.
INSERT INTO admin_alert_rule(id, enabled, severity, threshold, window_minutes, business_start_hour, business_end_hour, business_days)
VALUES ('off-hours-admin', false, 'medium', 1, 60, 7, 19, '1,2,3,4,5');
-- Actor-based bursts count one administrator's actions inside a window.
CREATE INDEX admin_audit_actor_detection ON admin_audit(actor, action, at);
