# `groups` module

**Architecture position:** the MLS Delivery Service of specs §6.3–6.5 and §12.4 (tasks GRP-01/02).
Depends on `identity` (`IdentityApi` for device liveness) and `messaging` (`DeliveryApi` for
in-transaction fan-out). Group names, descriptions and all messages are end-to-end encrypted
inside MLS application messages; the server sees only IDs, epochs, rosters and roles.

| Endpoint | Purpose |
|---|---|
| `POST /v1/groups` | Create: creator becomes owner; Welcome fanned out to initial devices |
| `GET /v1/groups/mine` | Groups of the caller's account with role and epoch |
| `GET /v1/groups/{gid}` | Members, roles and device roster (members only) |
| `POST /v1/groups/{gid}/commits` | Ordered commit acceptance (epoch CAS), roster/ACL changes, Welcome to added devices |
| `PUT /v1/groups/{gid}/messages` | Application message fan-out (current epoch only) |

Ordering & consistency (specs §6.4, §27.3): the group row is locked, a commit is accepted only for
the current epoch (`EPOCH_CONFLICT` otherwise), and the epoch increment, event record, roster/ACL
changes and fan-out commit in one transaction. Commits carry `group_seq`; retries with the same
submission ID return the original acceptance (`IDEMPOTENCY_CONFLICT` if bytes differ).

Authorization mirror (specs §30.2): adding/removing other accounts or their devices needs `admin`
or `owner`; any member may add or remove its **own** devices (linked-device join); role changes are
owner-only and the last owner cannot be removed or demoted. Clients still validate MLS
authentication themselves; this ACL is a server-side mirror, not the cryptographic authority.

Revoked devices are dropped from the routing roster immediately (no new ciphertext); members commit
the MLS removal (GRP-02 pending-removal gate is a follow-up).

`GroupsApi` (module root) exposes read-only current membership to other modules (used by `calls`).

## Leaving (pending removal)

A committer cannot remove itself in MLS. `POST /v1/groups/{id}/leave` therefore takes the account
out of the ACL immediately (no further application fan-out, owner hand-over enforced) and records
it in `mls_group_departures` (V15). `GroupDto.departed` lists such accounts; any remaining member
may commit their Remove (an exception to the admin-only membership rule), which clears the row.

## Invite links and join requests

`InviteService` (V16): owners/admins create bearer links (24 random bytes; only the SHA-256 is
stored, `enclave.groups.invite-ttl`, default 7 days) or reset all links. A signed-in user with a
link files a join request (bounded by `enclave.groups.max-join-requests`); nothing about the group
is revealed. Admins list/decline requests; approving is an ordinary MLS add, and any commit that
adds a member clears that member's request.
