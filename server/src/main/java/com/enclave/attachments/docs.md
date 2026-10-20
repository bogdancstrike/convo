# `attachments` module

**Architecture position:** owns encrypted attachment objects (specs §7, §12.5; task FEAT-01).
Depends only on `contracts`. Clients encrypt files *before* upload and send the key, digest and
attachment ID inside end-to-end encrypted messages; the server stores ciphertext only.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /v1/attachments/upload-form` `{size}` | device | Registers an attachment ID and returns a presigned `PUT` URL (15 min) bound to the exact size |
| `GET /v1/attachments/{id}` | device | Returns a presigned `GET` URL (5 min) |

Design rules:

* **No uploader/recipient columns** — possession of the random attachment ID plus the in-message
  key is the capability; downloads are not counted per recipient (metadata minimization).
* Objects expire after `enclave.attachments.retention` (default 30 days) and are deleted by a
  scheduled purge together with their registry rows.
* Presigned URLs use the public endpoint (`enclave.attachments.public-endpoint`) so browsers reach
  the object store through the same origin; the internal endpoint is used for administration.

Internals: `internal/AttachmentService` (use cases), `internal/ObjectStore` (S3 adapter + bucket
bootstrap), `internal/AttachmentRepository`, `internal/AttachmentsProperties`,
`internal/AttachmentController`.
