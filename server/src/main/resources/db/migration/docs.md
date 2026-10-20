# Database migrations

Flyway migrations for the single PostgreSQL schema. Each file is prefixed by the owning module so
table ownership (specs §1.2, ARF §15.2) stays explicit:

| Migration | Owner module | Tables |
|---|---|---|
| `V1__identity.sql` | identity | `accounts`, `devices`, `enrollment_reservations`, `signed_prekeys`, `one_time_prekeys`, `device_request_ids` |
| `V2__messaging.sql` | messaging | `submissions`, `envelopes`, `ws_tickets` |
| `V3__identity_provisioning.sql` | identity | `provisioning_sessions` |

Spring Modulith's `event_publication` registry table is created by the
`spring-modulith-starter-jdbc` schema initializer.

Rules for contributors:

* Never edit a released migration; add a new `V<n>__<module>_<change>.sql`.
* Use expand → migrate → contract for breaking changes (ARF §16, OPS-03).
* Store only public keys, ciphertext and the minimum metadata. No plaintext content columns.
