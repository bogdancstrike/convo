# `identity.internal.enrollment`

First-device enrollment (specs §4.3, §27.1; task ID-01). Linking additional devices (ID-02)
will add a `LinkService` here that reuses reservations with `purpose = link`.

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
