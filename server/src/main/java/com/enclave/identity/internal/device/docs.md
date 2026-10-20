# `identity.internal.device`

Device records and lifecycle.

* `DeviceRepository` — SQL over `devices`; `revoke` also deletes the device's prekeys so a
  revoked device can never be selected for new sessions.
* `DeviceService` — own-device listing and revocation. Revocation locks the account row, bumps the
  device-list version and publishes `DeviceRevoked` in the same transaction (specs §4.7).
* `IdentityApiImpl` — implementation of the module's public `IdentityApi` (rosters for fan-out,
  liveness checks for sockets).

Only public verification keys and an owner-encrypted label are stored; `last_seen_day` is kept at
day granularity to minimize activity metadata.
