# `messaging` module

**Architecture position:** owns delivery (specs §9–10, §26; tasks MSG-01/02). Depends on the
identity module's public `IdentityApi` and consumes its `DeviceRegistered`, `DeviceRevoked` and
`PrekeysLow` events. Never sees plaintext or keys.

| Package | Responsibility |
|---|---|
| `internal/mailbox` | Per-device envelope storage, drain/ack, expiry purge, revocation purge |
| `internal/submission` | Idempotent direct submissions with device-list validation (`DEVICE_MISMATCH`/`STALE_DEVICES`) |
| `internal/gateway` | WebSocket endpoint `/v1/ws`, one-use tickets, session registry, Valkey `mail:*`/`ctl:*` hints, directives |
| `internal/web` | REST fallback: `PUT /v1/messages/{accountId}`, `GET /v1/messages`, `DELETE /v1/messages/{guid}`, `POST /v1/ws/tickets` |

Delivery guarantees (specs §10): `SendResult{ok}` = committed to PostgreSQL; at-least-once per
device; envelope deleted only on that device's ack; Valkey hints are best effort and every client
`ping` re-checks the mailbox, so a lost hint costs at most one keepalive interval.

Configuration: `enclave.messaging.*` (`MessagingProperties`).
