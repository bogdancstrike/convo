# `identity.internal.auth`

Device proof-of-possession authentication (specs §4.2, tasks PRIV-02).

| Type | Role |
|---|---|
| `DeviceKeyProfile` | Versioned signing profiles. `p256-ecdsa-sha256-v1` = WebCrypto/Keystore P-256, P1363 signatures, SPKI public keys. |
| `DeviceSignatureAuthenticator` | Implements the public `DeviceRequestAuthenticator`; verifies canonical request signatures (format documented on `SignedDeviceRequest`). |
| `RequestIdRepository` | Single-use request-ID replay cache with scheduled expiry purge. |

The HTTP side (header extraction, body buffering) lives in `platform.security`; this package only
decides whether a request is authentic.

**Profile:** each request binds a
client-chosen single-use request ID + ≤5-minute expiry, and (profile V2, PRIV-02) a single-use
server-issued nonce: every authenticated response returns `X-Enclave-Next-Nonce`; an empty client
pool is refilled from `POST /v1/device-nonces` (unauthenticated, device-bound, 2-minute TTL, ≤ 64
live per device, hashes only, `device_nonces` V23). The nonce is consumed only after the signature
verifies; unknown/used/expired → `NONCE_INVALID` (client refetches and retries once; nothing was
processed). `require-nonce` refuses V1. Vectors: `contracts/vectors/device-auth-v2.json`.
