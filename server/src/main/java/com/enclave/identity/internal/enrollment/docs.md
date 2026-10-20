# `identity.internal.enrollment`

Device enrollment (specs §4.3–4.4, §27.1; tasks ID-01/02): first-device (`registerPrimary`) and
linked-device (`registerLinked`, authorized by `provisioning.ProvisioningService`) registration.
Both share `complete(...)`; `EnrollmentKeys` is the common key-material interface implemented by
`PrimaryRegistration` and `LinkRegistration`.

Flow:

1. `reserve` — after Keycloak sign-in, provision the account just-in-time, lock it, check device
   limits and allocate a never-reused device ID plus a 32-byte challenge (10-minute TTL).
2. Client generates keys locally, signs the `EnrollmentTranscript` with its proof-of-possession key
   and persists pending enrollment state *before* submitting.
3. `registerPrimary` — verifies ownership/expiry/single use of the reservation, the transcript
   signature and key formats, then atomically inserts the device, identity key and prekeys,
   consumes the reservation, bumps the device-list version and publishes `DeviceRegistered`.

A retry after an uncertain response with the same signing key returns the original result; a
different key on a consumed reservation is rejected (no duplicate devices from repeated taps).

Linking differs in two checks: the reservation purpose is `link`, the submitted identity key must
equal the account's existing identity key (shared IK, specs §3.3), and the provisioning session
must be approved with a matching single-use code.
