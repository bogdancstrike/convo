# Database migrations

Flyway migrations for the single PostgreSQL schema. Each file is prefixed by the owning module so
table ownership (specs §1.2, ARF §15.2) stays explicit:

| Migration | Owner module | Tables |
|---|---|---|
| `V1__identity.sql` | identity | `accounts`, `devices`, `enrollment_reservations`, `signed_prekeys`, `one_time_prekeys`, `device_request_ids` |
| `V2__messaging.sql` | messaging | `submissions`, `envelopes`, `ws_tickets` |
| `V3__identity_provisioning.sql` | identity | `provisioning_sessions` |
| `V4__attachments.sql` | attachments | `attachments` |
| `V5__identity_key_packages.sql` | identity | `mls_key_packages` |
| `V6__messaging_group_envelopes.sql` | messaging | `envelopes` (+ `group_id`, `epoch`, `group_seq`) |
| `V8__identity_directory.sql` | identity | `accounts` (+ `display_name`, `phone`, `phone_digits`, `search_text`, trigram indexes) |
| `V7__groups.sql` | groups | `mls_groups`, `mls_group_members`, `mls_group_devices`, `mls_group_events`, `mls_group_submissions` |

Spring Modulith's `event_publication` registry table is created by the
`spring-modulith-starter-jdbc` schema initializer.

Rules for contributors:

* Never edit a released migration; add a new `V<n>__<module>_<change>.sql`.
* Use expand → migrate → contract for breaking changes (ARF §16, OPS-03).
* Store only public keys, ciphertext and the minimum metadata. No plaintext content columns.

`V30__admin_security.sql` adds durable alert rules, inbox/history, processing cursor and coarse
session observations. It starts projection at the existing audit head and adds an action/time
detection index. No cleanup job or data deletion is introduced.
