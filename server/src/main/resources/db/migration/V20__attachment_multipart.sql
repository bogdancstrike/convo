-- Resumable (S3 multipart) attachment uploads (FEAT-01). Only a hash of the per-upload secret is
-- stored; the attachment ID alone (which recipients learn) cannot continue or complete an upload.
ALTER TABLE attachments
    ADD COLUMN upload_id          text,
    ADD COLUMN upload_secret_hash bytea,
    ADD COLUMN upload_deadline    timestamptz,
    ADD COLUMN completed_at       timestamptz;

CREATE INDEX attachments_open_multipart ON attachments (upload_deadline)
    WHERE upload_id IS NOT NULL AND completed_at IS NULL;
