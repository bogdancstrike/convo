# `identity.internal`

Private implementation of the identity module. Nothing here may be referenced from another module
(enforced by `ModularityTests`).

* `IdentityProperties` — typed `enclave.identity.*` configuration.
* `account/`, `device/`, `enrollment/`, `keys/`, `auth/`, `web/` — see each package's `docs.md`.

Persistence uses Spring `JdbcClient` with explicit SQL: the schema is security-relevant
(atomic device-ID allocation, single-use prekey claims) and is easier to review as SQL than as
ORM mappings.
