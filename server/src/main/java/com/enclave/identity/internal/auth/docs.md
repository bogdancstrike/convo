# `identity.internal.auth`

Device proof-of-possession authentication (specs §4.2, tasks PRIV-02).

| Type | Role |
|---|---|
| `DeviceKeyProfile` | Versioned signing profiles. `p256-ecdsa-sha256-v1` = WebCrypto/Keystore P-256, P1363 signatures, SPKI public keys. |
| `DeviceSignatureAuthenticator` | Implements the public `DeviceRequestAuthenticator`; verifies canonical request signatures (format documented on `SignedDeviceRequest`). |
| `RequestIdRepository` | Single-use request-ID replay cache with scheduled expiry purge. |

The HTTP side (header extraction, body buffering) lives in `platform.security`; this package only
decides whether a request is authentic.

**Known gap:** the launch profile asks for a server-issued nonce; the current profile uses a
client-chosen single-use request ID + ≤5-minute expiry. See `tasks.md` (PRIV-02).
