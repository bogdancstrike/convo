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
