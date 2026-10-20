# `identity.internal.web`

REST adapters of the identity module. Controllers translate JSON (`IdentityDtos`, base64url
binary fields) into domain commands and never contain business rules.

| Endpoint | Auth | Controller |
|---|---|---|
| `POST /v1/devices/reservations` | Keycloak bearer | `EnrollmentController` |
| `POST /v1/devices/primary` | Keycloak bearer | `EnrollmentController` |
| `GET /v1/devices`, `DELETE /v1/devices/{id}`, `DELETE /v1/devices/self` | device signature | `DeviceController` |
| `PUT /v1/keys`, `GET /v1/keys/status`, `POST /v1/keys/{accountId}/claim` | device signature | `KeyController` |
| `GET /v1/accounts/me`, `GET /v1/accounts/{id}`, `GET /v1/accounts/{id}/devices`, `GET /v1/directory/search?q=` | device signature | `AccountController` |

Which routes use which authentication is configured centrally in `platform.security`.
`OidcIdentityResolver` maps a validated JWT to `(issuer, sub, username-claim)`.
