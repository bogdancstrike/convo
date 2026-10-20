# `identity.internal.account`

Accounts and the organization directory.

* `AccountService` — just-in-time provisioning: maps a verified `(issuer, sub)` to an application
  `account_id` (UUIDv4) and derives a unique handle via `UsernamePolicy`.
* `DirectoryService` — search by handle prefix, IdP display name (word prefix, diacritic-folded) or
  phone digits (≥ 4); only active accounts with an active device (ADR-0002).
* `DirectoryText` — folding/normalization helpers for search text and phone digits.
* `AccountRepository` — explicit SQL over `accounts`, including atomic device-ID allocation
  (`allocateDeviceId`) and device-list version bumps.
* `OidcIdentity` — verified issuer/subject/username extracted from a Keycloak token by the web layer.

Privacy: directory attributes (display name, phone) are **IdP-managed organization data**, refreshed
from the token on each enrollment call; E2EE profile data never reaches the server (ADR-0002).
