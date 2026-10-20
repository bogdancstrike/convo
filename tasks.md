# Implementation progress

Running log of implemented work, mapped to the task IDs in [docs/tasks.md](docs/tasks.md).
`docs/tasks.md` acceptance checkboxes stay open until their full acceptance evidence exists; this
file tracks what is actually built, verified, and what is still missing.

Legend: ✅ done and verified · 🟡 partial (see notes) · ⬜ not started

## Foundations (FND)

| Status | Item | Task | Notes |
|---|---|---|---|
| ✅ | Spring Boot 4.1 / Spring Modulith 2.1 backend skeleton, Java 21, virtual threads | FND-03 | `server/` |
| ✅ | Module boundary verification (`ApplicationModules.verify()`) + generated module docs | FND-03 | `ModularityTests` |
| ✅ | React 19 + TypeScript + Vite web skeleton | FND-03 | `apps/web/` |
| ✅ | Browser Signal sessions (interim TS library, X3DH + Double Ratchet) proven in tests | FND-02 | PQXDH/Kyber pending Rust/WASM gate |

## Identity (ID-01)

| Status | Item | Notes |
|---|---|---|
| ✅ | JIT account provisioning from `(issuer, sub)`, handle derivation with diacritic folding | |
| ✅ | Device reservations (never-reused IDs, 10-min single-use challenge) | |
| ✅ | First-device registration with signed enrollment transcript, idempotent retry | |
| ✅ | Device proof-of-possession request signatures (ECDSA P-256, replay cache) | client-chosen request ID instead of server nonce (PRIV-02 follow-up) |
| ✅ | Signed/one-time prekey upload, status, atomic single-use claims, KEYS_LOW | Kyber prekeys pending |
| ✅ | Directory search by handle, device rosters, own-device list/unlink/self-revoke | |

## Messaging (MSG-01)

| Status | Item | Notes |
|---|---|---|
| ✅ | Idempotent direct submissions (digest dedupe, IDEMPOTENCY_CONFLICT) | |
| ✅ | All-or-nothing roster validation (DEVICE_MISMATCH / STALE_DEVICES) | |
| ✅ | Per-device mailbox, oldest-first drain, scoped acks, expiry & revocation purge | single table; partitioning later |
| ✅ | WebSocket gateway: one-use origin-bound tickets, bounded in-flight drain, ping safety net | |
| ✅ | Valkey `mail:*` / `ctl:*` hints + presence, local fallback | |
| ✅ | Persistent Modulith listeners for revocation / device-list / keys-low directives | |

## Web client

| Status | Item | Notes |
|---|---|---|
| ✅ | Encrypted IndexedDB store (AES-GCM records, HMAC key pseudonyms, atomic batches) | passphrase lock pending |
| ✅ | Content schema + padding + unknown-content placeholders | |
| ✅ | Signed HTTP client, resilient WebSocket (tickets, ping, jittered reconnect, 4401) | |
| ✅ | Browser-primary enrollment with pending-enrollment persistence and idempotent retry | |
| ✅ | Multi-device Signal fan-out (claims, registration-ID rebuild, DEVICE_MISMATCH/STALE handling) | |
| ✅ | Durable outbox: queued → ready → accepted, same-ciphertext retries, blocked/failed + Retry | |
| ✅ | Decrypt → atomic commit (ratchet + message + processed marker) → ack; GUID + semantic dedupe | |
| ✅ | Text, safe formatting, replies, reactions, author edit, delete-for-everyone, delete-for-me | |
| ✅ | Delivery receipts (on), read receipts and typing (off by default, settings) | |
| ✅ | Note to self, own-device sync transcripts and read cursors | |
| ✅ | Conversation list: search with diacritic folding, pin, mute, archive, unread, drafts | |
| ✅ | Safety numbers (5200 iterations), verify/clear, identity-change notice, blocked sends | |
| ✅ | Settings: theme, EN/RO language, receipts/typing, devices + unlink, sign-out wipe | |
| ✅ | Cross-tab leader lock (Web Locks, "Use here"), revoked/storage-lost/update/unreachable states | |
| ✅ | Strict CSP + security headers, same-origin nginx proxy | |

## Delivery & verification

| Status | Item | Notes |
|---|---|---|
| ✅ | Root `docker-compose.yaml`: Postgres, Valkey, Keycloak (realm import), SeaweedFS, server, web | |
| ✅ | Playwright e2e (Chromium + Firefox): enrollment, bidirectional E2EE chat, receipts, reactions, edit, delete, offline mailbox delivery, Note to self | 6/6 passing |

## Fixed along the way

* Composer cleared text typed while the previous message was being persisted (race) — fixed by
  clearing optimistically and restoring only on local failure.
* Unreadable local keys left an endless spinner — now shows a "set up this browser again" state.
* Keycloak advertised the nginx-internal port in its endpoints — proxy now forwards `Host:port`.

## Next up

| Item | Task |
|---|---|
| Device linking via QR provisioning (web ↔ web), linked-device sync | ID-02 |
| Encrypted attachments (SeaweedFS presigned URLs), photos, files, voice notes | FEAT-01 |
| Passphrase lock for browser storage | WEB-01 |
| Groups (server roster/ACL, ordered group events) and MLS client integration | GRP-01/02/03 |
| Durable push/notification intents (outbox table + workers) | MSG-02 |
| Admin console, audit log, policies | ADM-01 |
| Server-issued nonces for device proofs, Kyber prekeys | PRIV-02, FND-02 |
