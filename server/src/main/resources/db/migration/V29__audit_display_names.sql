-- Readable projections are outside the signed canonical fields; chain verification is unchanged.
ALTER TABLE admin_audit ADD COLUMN actor_name text;
ALTER TABLE admin_audit ADD COLUMN target_name text;
CREATE INDEX admin_audit_actor_name ON admin_audit(actor_name, seq);
CREATE INDEX admin_audit_target_name ON admin_audit(target_name, seq);
