# `identity.internal.account`

Accounts and the organization directory.

* `AccountService` — just-in-time provisioning: maps a verified `(issuer, sub)` to an application
  `account_id` (UUIDv4) and derives a unique handle via `UsernamePolicy`.
* `DirectoryService` — handle-prefix search returning only active accounts with an active device.
* `AccountRepository` — explicit SQL over `accounts`, including atomic device-ID allocation
  (`allocateDeviceId`) and device-list version bumps.
* `OidcIdentity` — verified issuer/subject/username extracted from a Keycloak token by the web layer.

Privacy: no display names or profile data are stored in plaintext; directory results are handles.
