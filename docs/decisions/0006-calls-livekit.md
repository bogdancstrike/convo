# ADR-0006: calls on self-hosted LiveKit with client-side frame encryption

Status: Accepted; web implemented 2026-10-21 (Chromium/Firefox E2E), Android in progress.

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
* A shared per-call key does not provide per-participant forward secrecy inside a call; removing
  a group member mid-call requires a new call (key rotation is follow-up work).
* No push: devices ring while Convo is open/connected (background ringing is a release gate in
  docs/mobile.md §6).
