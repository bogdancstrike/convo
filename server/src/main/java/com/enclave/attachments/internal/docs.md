# `attachments.internal`

| Type | Role |
|---|---|
| `AttachmentsProperties` | `enclave.attachments.*`: internal/public S3 endpoints, credentials, bucket, size limit, URL TTLs, retention |
| `ObjectStore` | AWS SDK v2 adapter: presigned PUT (exact `Content-Length`) / GET on the public endpoint, deletes and bucket bootstrap on the internal endpoint |
| `AttachmentService` | Upload forms, download URLs, scheduled expiry purge (object first, then row) |
| `AttachmentRepository` | `attachments` registry SQL |
| `AttachmentController` | `POST /v1/attachments/upload-form`, `GET /v1/attachments/{id}` |

Resumable uploads (FEAT-01, AC-MED-07, V20): `POST /v1/attachments/multipart` registers the
attachment, starts an S3 multipart upload and returns a random **upload secret** (stored only as a
SHA-256), the part size and part count. `…/multipart/parts` (presigned UploadPart URLs bound to
each part's exact length), `…/multipart/status` (parts already stored, for resuming) and
`…/multipart/complete` all require the secret, so the attachment ID that recipients later learn
cannot touch the upload; a wrong secret looks like an unknown upload. Completion lists the parts
server-side and requires every part with its exact length (clients never handle ETags). Downloads
are refused until completion. Unfinished uploads are aborted after `multipart-ttl` by the purge job.

Clients keep the attachment key, nonce prefix, a plaintext digest and the session with the
offline-queued file (encrypted local store), re-encrypt identically on resume (only for the same
plaintext — no nonce reuse), and upload only the missing parts.

Controllers resolve public signing endpoints from the trusted request origin when configured; the S3 Host is preserved through nginx, so LAN URLs remain valid without rewriting signatures.
