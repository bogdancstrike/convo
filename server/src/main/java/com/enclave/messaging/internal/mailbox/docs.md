# `messaging.internal.mailbox`

Per-device ciphertext queues (table `envelopes`, specs §10, §13, §24.5).

* `Envelope` / `EnvelopeType` — one queued ciphertext; type codes match the wire enum and are
  persisted, so they are append-only.
* `MailboxRepository` — oldest-first `(server_ts, guid)` pages, ack deletes scoped to the
  acknowledging device, quota sums, revocation and expiry purges.
* `MailboxService` — transactional façade used by the gateway and REST adapters; scheduled expiry
  purge (`enclave.messaging.expiry-purge-interval`, default 5 min).

Invariants: an envelope is deleted only by its own device's ack, by expiry, or by revocation of
that device. The server never inspects `content`.
