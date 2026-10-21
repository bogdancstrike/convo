# Communities module (COM-01, specs §30.3, §12.4a)

A community is an opaque `community_id` bound to one **root announcement group** (an admin-only
MLS channel owned by the creator). Joining the community = joining that root group (invite link +
approval, or an admin adding the account). Linked groups keep their own MLS context, roles,
membership and history; community roles grant nothing inside them.

| Endpoint | Who | What |
|---|---|---|
| `POST /v1/communities` | owner of an admin-only group that is not linked anywhere | register it as a community root |
| `GET /v1/communities/mine` | device | communities whose root this account is in (+ role) |
| `GET /v1/communities/{cid}/groups` | community member | active discoverable links; private/proposed only for root admins and the group's members |
| `POST /v1/communities/{cid}/links` | root owner/admin | link a group: active at once if the caller owns it, otherwise `proposed` |
| `POST /v1/communities/{cid}/links/{gid}/accept` | that group's owner | accept a proposal |
| `DELETE /v1/communities/{cid}/links/{gid}` | root owner/admin or the group's owner | unlink |
| `POST /v1/communities/{cid}/groups/{gid}/join` | community member | ask to join a discoverable linked group (a normal join request; its admins approve) |

Rules enforced here (P0): one parent per group (unique `group_id`), roots are never linked, no
nesting, at most 50 links per community, and a link becomes active only when every member of the
group is already a community member (no silent enrollment into the root audience). Outsiders get
`NOT_FOUND`. Authority comes from the groups module's mirrored roles via `GroupsApi.summary`.

Stored (V21): `communities` (ID, root group ID, version) and `community_group_links` (group,
visibility, status, proposer/acceptor, version). Names, descriptions and group labels stay E2EE:
clients keep them in the root group's metadata (`GroupMeta.community`, accepted only from root
owners/admins). Only **discoverable** links get a label there; private group names are never
broadcast to the root.

Not yet (later COM slices): announcement acknowledgements (§30.6), newcomer onboarding (§30.7),
parent-removal delegation and tracked membership operations (§30.3), owner-transfer rules for
community leave.

Clients: web `ui/screens/CommunitiesPanel.tsx`; Android `CommunitiesUI.kt` (Communities tab,
which replaces the Unread tab; Unread is now a chat-list filter chip).
