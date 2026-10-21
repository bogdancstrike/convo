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

Announcement acknowledgements (§30.6) are client-only E2EE: an announcement carries `ackRequest`
(request ID/revision, ≤ 10 owner/admin reviewers, audience snapshot), accepted only in a community
root from an owner/admin. A member's explicit response is a typed `ack` content sent pairwise to
each reviewer plus own-device sync (no server endpoint, no feed post, independent of read receipts);
reviewers accept it only from the audience for the current request revision and count it only for
the current content revision, so edits ask again. The server sees ordinary pairwise envelopes.

Newcomer onboarding (§30.7) is also client-only E2EE: `CommunityMeta.onboarding` holds a
versioned package (welcome, rules text + digest + version, optional rules acknowledgement with
reviewers, recommended discoverable groups, ≤ 20 checklist items), valid only from a current root
owner/admin. The rules version advances only when the rules text changes. Checklist progress is a
private record synced to own devices (`sync.onboarding`, higher mutation counter wins); rules
acknowledgements are a typed `rulesAck` (version + digest) to the named reviewers, who keep only
the current version's responses. Recommendations never enroll anyone.

Parent-removal delegation (§30.3, V22): a group owner may accept (or, linking their own group,
grant) that community removal also removes members from the group (`delegation`). When an
account leaves or is removed from the root (`GroupMembersRemoved` on the root), the module applies
`GroupsApi.removeOnBehalf` to every delegating active link: the account becomes "departed" (no
further fan-out, call tokens refused), devices get a content-free `GROUPS_CHANGED` hint, and any
remaining member's client commits the MLS removal. Each step is a `community_membership_ops`
row (`pending` → `completed` when the group's removal commit is accepted; `blocked` if the
account is the group's last owner), visible to community admins (`GET .../operations`). Groups
without delegation stay standalone.

Not yet (later COM slices): due dates/expiry/withdrawal and custom reviewer selection for
acknowledgements,
parent-removal delegation and tracked membership operations (§30.3), owner-transfer rules for
community leave.

Clients: web `ui/screens/CommunitiesPanel.tsx`; Android `CommunitiesUI.kt` (Communities tab,
which replaces the Unread tab; Unread is now a chat-list filter chip).
