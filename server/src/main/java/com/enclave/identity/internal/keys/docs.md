# `identity.internal.keys`

Signal prekey distribution (specs §5.1, §12.2; task ID-01).

* `PrekeyService.upload` — stores a replacement signed prekey and appends one-time prekeys,
  bounded by `enclave.identity.max-prekeys-per-upload` / `max-stored-prekeys`.
* `PrekeyService.claim` — returns one bundle per active device of the target account and consumes
  one one-time prekey per device atomically (`DELETE … FOR UPDATE SKIP LOCKED … RETURNING`), so two
  concurrent claimers can never receive the same key. Publishes `PrekeysLow` below the watermark.
* `SignedPreKey`, `OneTimePreKey`, `PreKeyBundle` — public key material records.

Signature verification of signed prekeys happens on clients under the peer's identity key; the
server stores and relays public material only. Kyber (PQXDH) prekeys and replay-safe claim IDs are
pending FND-02 (see `tasks.md`).

## MLS KeyPackages

* `KeyPackageService.upload` — stores client-generated KeyPackages (opaque, ≤ 8 KiB, client-computed
  `KeyPackageRef`), bounded per upload/device.
* `KeyPackageService.claim` — one package per active device of each requested account, consumed with
  the same `SKIP LOCKED` pattern; devices without packages are returned as `unavailable`;
  `KeyPackagesLow` drives the `KEYPACKAGES_LOW` directive.
* Revocation deletes a device's KeyPackages (`DeviceRepository.revoke`).
