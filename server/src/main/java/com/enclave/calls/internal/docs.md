# `calls.internal`

| Type | Role |
|---|---|
| `CallsProperties` | `enclave.calls.*`: enable flag, LiveKit key/secret (≥ 32 chars, env only), public path, token TTL, max call age, group size cap. |
| `CallRepository` | `calls` table (V14): call ID, random room name, creator, peer **or** group, video flag, timestamps. No content or participant log. |
| `CallService` | Create (direct peer must exist; caller must be a group member), join (re-checks authorization and expiry), end, hourly purge. Outsiders get `NOT_FOUND`. |
| `LiveKitTokens` | HS256 JWT: `iss` = API key, `sub` = `accountId:deviceId`, `video` grant for one room, 10-minute expiry. |
| `CallController` | `POST /v1/calls`, `POST /v1/calls/{id}/join`, `POST /v1/calls/{id}/end` (device-authenticated, `no-store`). |

| `LiveKitRooms` | RoomService client (Twirp JSON) with one-minute room-admin tokens: list/remove participants. |
| `CallMembershipListener` | On `GroupMembersRemoved` (persistent module listener), removes that account's devices from the group's open call rooms; clients then rotate the media key (ADR-0006). |
