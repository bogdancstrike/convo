# `contracts/` — cross-component contract fixtures

Language-neutral fixtures that both the Java backend and the TypeScript client test against, so
the two implementations of a wire/signature format cannot drift apart silently (FND-01).

| File | Contract | Verified by |
|---|---|---|
| `vectors/device-auth-v1.json` | `p256-ecdsa-sha256-v1` device request canonical string + signature, and the `ENCLAVE-ENROLL-V1` enrollment transcript | `DeviceAuthVectorsTest` (server), `contracts.test.ts` (web) |

Vectors contain **test-only** keys generated for this purpose. Never regenerate a released vector
in place: add `-v2` files when a format changes, and keep old vectors while the old profile is
accepted.
