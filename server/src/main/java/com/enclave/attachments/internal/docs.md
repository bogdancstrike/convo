# `attachments.internal`

| Type | Role |
|---|---|
| `AttachmentsProperties` | `enclave.attachments.*`: internal/public S3 endpoints, credentials, bucket, size limit, URL TTLs, retention |
| `ObjectStore` | AWS SDK v2 adapter: presigned PUT (exact `Content-Length`) / GET on the public endpoint, deletes and bucket bootstrap on the internal endpoint |
| `AttachmentService` | Upload forms, download URLs, scheduled expiry purge (object first, then row) |
| `AttachmentRepository` | `attachments` registry SQL |
| `AttachmentController` | `POST /v1/attachments/upload-form`, `GET /v1/attachments/{id}` |

Multipart/resumable uploads (AC-MED-07, EXT-02) will extend `ObjectStore` with multipart
presigning; the registry already stores the exact expected size.
