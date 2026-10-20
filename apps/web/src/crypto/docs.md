# `src/crypto` — browser cryptography adapters

Browser-side protocol facade (specs §3, §5; tasks FND-02, CORE-01/02). No custom cryptographic
constructions live here: Signal sessions come from `@privacyresearch/libsignal-protocol-typescript`
and everything else uses WebCrypto primitives.

| File | Purpose |
|---|---|
| `deviceKey.ts` | Non-extractable ECDSA P-256 device proof-of-possession key (`p256-ecdsa-sha256-v1`) |
| `signalStore.ts` | Signal `StorageType` over the encrypted store with a unit-of-work overlay, TOFU + verified-identity blocking |
| `content.ts` | E2EE content schema (data, receipts, own-device sync, typing) + validating codec; unknown kinds become placeholders |
| `padding.ts` | 160-byte bucket padding (specs §5.5) |
| `provisioning.ts` | Linking channel: X25519 → HKDF-SHA256 → AES-256-GCM bound to the `ENCLAVE-PROVISION-V1` transcript; 12-digit comparison code |

**Interim decision (FND-02 gate):** the specification targets libsignal (Rust/WASM) with PQXDH.
Until the browser build of the shared Rust core passes its feasibility gate, the web client uses
the TypeScript Signal implementation (X3DH + Double Ratchet, no Kyber/PQ ratchet). This is
recorded in `docs/decisions/0001-interim-browser-signal.md` and must be replaced before launch.

Tests: `padding.test.ts`, `content.test.ts`, `signalStore.test.ts`.
