# `calls` — call authorization and LiveKit tokens

**Architecture position:** a small module next to `messaging` and `groups`. It does not carry
media or ring signals; it only decides *who may join which room* and signs short-lived
LiveKit tokens.

* Media: self-hosted [LiveKit](https://livekit.io) SFU (Apache-2.0) in Compose, with
  [coturn](https://github.com/coturn/coturn) as TURN relay for restricted networks. The browser
  reaches LiveKit's signalling through the same-origin nginx path `/rtc`.
* End-to-end media encryption: the caller generates a random key and sends it inside the
  Signal/MLS-encrypted call invite. Clients use LiveKit's E2EE (insertable streams / frame
  cryptors); LiveKit and this server only see encrypted frames.
* Ringing, accept/decline/cancel/end are ordinary E2EE messages (`kind: 'call'`).

Public API: none (HTTP only). Depends on `identity.IdentityApi` (peer exists) and
`groups.GroupsApi` (current members). See `internal/docs.md`.
