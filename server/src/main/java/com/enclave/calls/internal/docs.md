# `calls.internal`

| Type | Role |
|---|---|
| `CallsProperties` | `enclave.calls.*`: enable flag, LiveKit key/secret (≥ 32 chars, env only), public path, token TTL, max call age, group size cap. |
| `CallRepository` | `calls` table (V14): call ID, random room name, creator, peer **or** group, video flag, timestamps. No content or participant log. |
| `CallService` | Create (direct peer must exist; caller must be a group member), join (re-checks authorization and expiry), end, hourly purge. Outsiders get `NOT_FOUND`. |
| `LiveKitTokens` | HS256 JWT: `iss` = API key, `sub` = `accountId:deviceId`, `video` grant for one room, 10-minute expiry. |
| `CallController` | `POST /v1/calls`, `POST /v1/calls/{id}/join`, `POST /v1/calls/{id}/end`, call links: `POST /v1/calls/links`, `POST /v1/calls/links/{token}/resolve`, `DELETE /v1/calls/links/{token}` (device-authenticated, `no-store`). |
| `CallLinks` | Member call links (AC-CALL-07, V32 `call_links`): 32-byte token shown once, only its SHA-256 stored; 24 h default, 7 d max (`link-ttl`, `max-link-ttl`). Creating and resolving require current group membership, and joining re-checks it when the LiveKit token is issued. Resolving returns the group and its newest open call. Only the creator can revoke. Links never admit non-members, guests or anonymous users, and the media key never reaches the server. |
| `LiveKitRooms` | RoomService client (Twirp JSON) with one-minute room-admin tokens: list/remove participants. |
| `CallMembershipListener` | On `GroupMembersRemoved` (persistent module listener), removes that account's devices from the group's open call rooms; clients then rotate the media key (ADR-0006). |
