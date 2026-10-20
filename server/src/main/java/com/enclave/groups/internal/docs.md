# `groups.internal`

| Type | Role |
|---|---|
| `GroupService` | Create, ordered commit acceptance with ACL mirror, application fan-out, revocation roster cleanup |
| `GroupCommands` | Decoded command records |
| `GroupRepository` | SQL for `mls_groups`, `mls_group_members`, `mls_group_devices`, `mls_group_events`, `mls_group_submissions` |
| `Role` | `owner` / `admin` / `member` |
| `GroupsProperties` | `enclave.groups.*` limits (members, devices, message/handshake sizes, idempotency retention) |
| `GroupController` | REST adapter (`/v1/groups/**`) |

Locking: commits take `FOR UPDATE` on the group row; application messages take `FOR SHARE`, so
messages never interleave with an epoch change mid-transaction.
