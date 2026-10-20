# `platform.security`

Spring Security wiring for the two authentication layers of specs §4.1:

| Chain | Matches | Authentication |
|---|---|---|
| `accountChain` (order 1) | `/v1/devices/reservations`, `/v1/devices/primary`, `/v1/devices/link`, `/v1/provisioning/sessions` | Keycloak bearer JWT (`JwtDecoder` with internal JWKS URI + public issuer + optional audience) |
| `deviceChain` (order 2) | all other `/v1/**` | `DeviceSignatureFilter` → identity `DeviceRequestAuthenticator`; `/v1/deployment-info` and `/v1/ws` are public (WS uses one-use tickets) |
| `operationsChain` (order 3) | `/actuator/**` | health/info public, everything else denied |

* `DeviceSignatureFilter` — parses `Authorization: EnclaveDevice <addr>` + `X-Enclave-*` headers,
  buffers the body (`CachedBodyRequest`, bounded by `enclave.security.max-body-bytes`) and sets an
  `AuthenticatedDevice` principal.
* `SecurityProperties` — `enclave.security.*`: OIDC issuer/JWKS/audiences/public client ID,
  allowed browser origins, body limit.

All failures are rendered as RFC 9457 problem details through `platform.web.ProblemWriter`.
Stateless: no cookies, no HTTP sessions, so no CSRF surface.
