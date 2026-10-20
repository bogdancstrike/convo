# `src/api` — transport to the Enclave backend

| File | Purpose |
|---|---|
| `http.ts` | `HttpClient`: bearer (enrollment) and device-signed requests. Implements the canonical `ENCLAVE-REQ-V1` signature string verified by the server's `DeviceSignatureAuthenticator`. |
| `enclaveApi.ts` | Typed facade for REST endpoints (accounts, devices, keys, directory, tickets, REST send fallback). |
| `socket.ts` | `GatewaySocket`: one-use ticket auth, request/response multiplexing by `requestId`, 30 s ping, jittered exponential reconnect, 4401 revocation handling. |
| `types.ts` | Wire DTOs mirroring `IdentityDtos` / `WireFormat` on the server. |
| `errors.ts` | `ApiError` (RFC 9457, stable `code`) and `NetworkError` (unknown outcome). |

Rules: no cookies (`credentials: 'omit'`), no caching (`cache: 'no-store'`), no referrer. The API
layer never sees plaintext — it only moves ciphertext produced by `src/core`.
