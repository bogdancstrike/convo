# `com.enclave` — backend root

This package holds `EnclaveApplication`, the single Spring Boot / Spring Modulith runtime that
implements the API, WebSocket gateway, and background workers described in
[`docs/arf.md` §3.1](../../../../../../docs/arf.md) and ADR-026.

## Module map

Every direct sub-package is an **application module**. Its top-level package is the module's
public API (types other modules may use); everything under `internal/` is private and enforced by
`ModularityTests` (`ApplicationModules.verify()`).

| Module | Role | Depends on |
|---|---|---|
| `contracts` | Shared module: narrow IDs, error codes, byte encoding. No business logic. | — |
| `identity` | Accounts, devices, enrollment, prekeys, directory, device request authentication. | contracts |
| `messaging` | Idempotent submissions, per-device mailboxes, WebSocket gateway, Valkey hints. | identity, contracts |
| `groups` | MLS Delivery Service: ordered commits, role ACL mirror, device roster, group fan-out. | identity, messaging, contracts |
| `attachments` | Presigned upload/download of client-encrypted attachment blobs, retention purge. | contracts |
| `platform` | Cross-cutting runtime wiring: HTTP security chains, error rendering, deployment info. | identity, contracts |

Rules:

* Modules talk through public API types and Spring Modulith domain events — never through another
  module's repositories, tables or `internal` classes.
* Each module owns its tables (see `src/main/resources/db/migration/docs.md`).
* The server only ever handles ciphertext; no module may accept or log message plaintext or keys.
