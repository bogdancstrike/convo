# ADR-0001 (implementation): interim TypeScript Signal library in the web client

| Field | Value |
|---|---|
| Status | Accepted for development; **must be superseded before launch** |
| Date | 2026-10-20 |
| Related | specs §3.1, §5, §27.4; tasks FND-02, CORE-01/02; ARF ADR-004/010 |

## Context

The specification places all protocol cryptography in a shared Rust core (libsignal, OpenMLS),
exposed to the browser through a WASM/worker facade. Browser portability of that dependency graph
is an explicit M0 feasibility gate (FND-02) that has not been run yet. Building the rest of the
product (backend, delivery, UI, storage, end-to-end tests) should not wait on that gate, but it
also must not use custom cryptography.

## Decision

Until the Rust/WASM browser core passes FND-02, the web client uses
`@privacyresearch/libsignal-protocol-typescript` (X3DH + Double Ratchet over Curve25519, MIT/GPL
mixed licensing to be confirmed in the license inventory) behind the `src/crypto` and `src/core`
facades:

* All protocol state access goes through `SignalStore` (unit-of-work commits), so replacing the
  library changes only the adapter, not storage, outbox or UI code.
* Wire formats (envelope types, prekey bundle shape, 33-byte DJB identity keys) match libsignal,
  so the server API does not change when the implementation is replaced.

## Consequences and known gaps

* **No PQXDH / Kyber prekeys and no sparse PQ ratchet.** Post-quantum claims (specs §3.2) do not
  hold for this build.
* The library's receive-side `isTrustedIdentity` call for prekey messages is not awaited
  (upstream bug); `SessionManager.decrypt` re-checks verified identities as defense in depth.
* The library is not independently reviewed for this product (SEC-02 scope).
* Interoperability with the future Android (Rust core) client must be proven with shared vectors
  before Android work depends on it.

Exit criterion: FND-02 produces a browser build of the pinned libsignal profile; this ADR is then
marked *Superseded* and the adapter is replaced.
