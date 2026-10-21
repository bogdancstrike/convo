# ADR-0006: calls on self-hosted LiveKit with client-side frame encryption

Status: Accepted; implemented 2026-10-21 on web (Chromium/Firefox E2E) and Android
(livekit-android, emulator ↔ browser verified in both directions with encrypted frames).

## Context

Convo needs 1:1 and small-group voice/video calls on-prem, through LAN/NAT and restricted
networks, without the server or media relay being able to see or hear calls. Building an SFU,
TURN server or congestion control ourselves would be slow and risky.

## Decision

* Media: **LiveKit** server (Apache-2.0, `livekit/livekit-server`) as SFU and **coturn** as TURN
  relay, both in `docker-compose.yaml`. Browsers reach LiveKit signalling through the existing
  same-origin nginx (`/rtc`); media uses UDP 50000-50100 (TCP 7881 fallback) on `CONVO_SERVER_IP`.
* Clients: official SDKs (`livekit-client` on web, `livekit-android` on Android).
* Authorization: the Convo server's `calls` module creates a call record (direct peer or group)
  and signs 10-minute LiveKit JWTs per device (`accountId:deviceId`). Group calls re-check
  current membership for every join token.
* Signalling: ring/accept/decline/busy/cancel/end are E2EE `call` messages over the existing
  Signal/MLS channels, synced to the account's other devices (first answer stops the others).
* Media E2EE: the caller creates a random 256-bit key per call and sends it only inside the ring.
  Clients enable LiveKit E2EE (insertable streams / RTCRtpScriptTransform, frame cryptors) with
  that shared key. Browsers without support are refused; there is no unencrypted fallback. The UI
  shows "End-to-end encrypted" only after LiveKit reports every remote participant's frames as
  encrypted.
* Ring freshness uses server envelope timestamps (45 s); late rings become missed calls.
  Call history is device-local and never uploaded.

## Consequences

* The SFU sees metadata (who is in a room, when, packet sizes), not content.
* A shared per-call key does not provide per-participant forward secrecy inside a call. Group calls
  rotate it whenever someone leaves the room (2026-10-21): the smallest remaining participant
  identity sends `rekey` (new key + generation) through the MLS group; the key index is
  `generation mod 16`, so older frames still decrypt while everyone switches; concurrent rekeys
  converge (higher generation, then smaller key). Removing or banning a member, or a member
  leaving the group, publishes `GroupMembersRemoved`; the calls module removes that account's
  devices from the group's open rooms via LiveKit's RoomService, which triggers the rekey. Since
  the rekey travels in the MLS group they were removed from, they cannot follow the new key.
  Android switches sender key indexes through `FrameCryptor.setKeyIndex` on the SDK's private
  cryptor map (reflection, logged if it fails — it then keeps the previous key, still encrypted).
* Background ringing uses content-free UnifiedPush wakes (push module, MSG-02).
