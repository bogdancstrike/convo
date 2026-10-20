# Encrypted account history

`HistoryService` stores opaque, idempotent account-owned ciphertext entries in a serialized
per-account sequence. `HistoryController` exposes signed-device PUT and paged GET endpoints.
Unlike transient mailboxes, the archive survives device/browser loss and does not expire by the
mailbox TTL. Content encryption, validation and restoration belong to clients (ADR-0004).
