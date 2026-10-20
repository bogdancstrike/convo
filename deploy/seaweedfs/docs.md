# `deploy/seaweedfs` — development object storage

SeaweedFS provides the S3-compatible store for encrypted attachments (specs §7, ADR-016).
`s3.json` defines a **development-only** access key. Attachments are encrypted on clients before
upload, so the object store only ever holds ciphertext.
