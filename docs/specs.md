# Enclave — Technical Specification

| Field | Value |
|---|---|
| Document | Technical specification |
| Status | Draft v1.2 — direct chats, groups, communities; Android/web first |
| Updated | 2026-10-16 |
| Related | [Architecture](arf.md), [UI](UI.md), [Mobile](mobile.md), [Tasks](tasks.md), [Sources](sources.md), [Diagrams](diagrams/README.md) |
| Normative language | MUST, SHOULD, MAY as in RFC 2119 |

This document specifies **how** Enclave works: components, identities, cryptography (1:1 and group), the wire protocol, delivery semantics, REST and WebSocket APIs, data model, 1:1 and group calling, push notifications, and operational concerns. Code samples are illustrative and pinned to concepts rather than exact library versions; library APIs (notably `libsignal` and OpenMLS) evolve and MUST be validated against the pinned versions in the build.

---

## 0. Product scope and release contract

Enclave is a customer-operated, secure messaging platform with a friendly Android app and a full web client in the first release. iOS follows after Android/web stabilization; desktop packaging is optional later work. One deployment represents one organization/security domain. Development, test, and production have separate keys, storage, and identity issuers.

**Security promise:** message bodies, attachments, profiles, and call media are encrypted between authorized endpoints. The infrastructure still processes routing and operational metadata. A compromised endpoint or malicious web bundle can expose content available to that endpoint. The product combines useful interaction patterns from Signal, Telegram, and WhatsApp while retaining its own on-prem E2EE model; it does not claim network interoperability, exhaustive feature parity, or equivalent security assurance.

**Priorities:** P0 is required for Android/web general availability (GA); P1 is a subsequent release; P2 is research or an optional extension. A P0 prototype is not a production release. No milestone dates are asserted without a staffed estimate.

### 0.1 Requirements and acceptance

| ID | Priority | Requirement and observable acceptance |
|---|---|---|
| FR-ID-01 | P0 | Organization URL/managed bootstrap, SSO with PKCE and MFA; first-use Android and web users can sign in without a phone number or uploading an address book. |
| FR-DEV-01 | P0 | Link Android and web, list/revoke devices, show identity changes, and sync own sent/read state; new devices cannot silently obtain old history. |
| FR-MSG-01 | P0 | E2EE direct text, emoji, replies, reactions, mentions, edits, delete requests, encrypted files/photos, voice notes, delivery/read preferences, drafts, mute/archive/pin, and Note to self. Offline retries do not create duplicate messages. |
| FR-MSG-08 | P1 | Sealed-sender deliveries use a separate unauthenticated transport and abuse controls; authenticated WebSockets must never advertise sender anonymity. |
| FR-GRP-02 | P0 | E2EE groups: add/remove users, promote members to admin, demote admins under policy, transfer ownership, approve join requests, manage links/permissions, shared pins and moderation; targets of 1,000 accounts subject to §6/§30 limits. |
| FR-COM-01 | P0 | E2EE communities with admin-only announcement feeds, owner/admin/member roles, community membership, and separately permissioned linked discussion groups; no automatic subgroup-content access for community admins (§30). |
| FR-COM-02 | P0 | Optional per-announcement explicit acknowledgements, with revision-bound account dedupe, offline retry, and E2EE reports restricted to named authorized reviewers; independent of read receipts (§30.6). |
| FR-COM-03 | P0 | Versioned community welcome, rules acknowledgement, recommended eligible groups, and a privately synced newcomer checklist; onboarding never grants subgroup access or exposes old history (§30.7). |
| FR-MSG-02 | P0 | Shared message pins, explicit forwarding with destination review, safe basic formatting, message requests/blocking, media galleries, and private saved-message organization (§30.4). |
| FR-UX-02 | P0 | Rich encrypted group/community descriptions with purpose, safe links, rules references and contact people (§30.8). |
| FR-UX-03 | P0 | Private per-chat themes/wallpapers with accessible contrast and E2EE own-device preference sync (§30.8). |
| FR-GRP-03 | P0 | Search members/filter admins within authorized spaces; show locally computed active groups in common without a new social-graph directory (§30.8). |
| FR-MED-01 | P0 | Ordered photo albums with captions, stable per-photo references, upload recovery and one logical message/expiry boundary (§30.8). |
| FR-NOTIF-01 | P0 | Mentions-only notifications verified locally after decryption, plus timed conversation snoozing that restores prior settings (§30.8). |
| FR-UX-04 | P0 | First-unread catch-up, jump to latest, and return to saved position across restart without manufacturing read receipts (§30.8). |
| FR-MSG-03 | P0 | Bounded multi-message copy/forward/save/delete with per-item authorization, expiry checks and partial-result feedback (§30.8). |
| FR-UX-05 | P0 | Android swipe/long-press and web hover/focus/context-menu/keyboard actions with equivalent accessible controls (§30.8). |
| FR-CAL-01 | P0 | Android/web 1:1 audio/video with TURN fallback; microphone/camera denial, ringing on multiple devices, and network changes have explicit outcomes. |
| FR-CAL-05 | P1 | Group video, screen sharing, and P2P-to-SFU escalation, gated on E2EE compatibility and membership rotation evidence. Initial target: 50 participants. |
| FR-SEC-06 | P0 | Revoke server access immediately on commit, reject subsequent requests, close existing connections within 60 s, attempt local wipe on next contact; explain that offline erasure cannot be guaranteed. |
| FR-SEC-07 | P0 | Verify identity by QR/numeric fingerprint; verified identity replacement blocks sending until reconfirmed. |
| FR-UX-01 | P0 | Keyboard/screen-reader usable web app, TalkBack usable Android app, light/dark themes, English/Romanian localization, friendly empty/error/offline states. |
| FR-SRC-01 | P0 | Search local decrypted history and files, including Romanian diacritics; no query or result content reaches a server. |
| FR-ADM-01 | P0 | Separate administration for users, guests, devices, policies, health, and auditable actions; no conversation reading interface. |
| FR-OPS-01 | P0 | Install, upgrade, back up, and restore without SaaS; signed offline bundles and tested private-CA rotation. |
| FR-IOS-01 | P1 | iOS native lifecycle, notifications, calling, storage, and accessibility reuse the established protocols; no dependency from Android/web milestones. |
| FR-EXT-01 | P1 | Polls, community events/RSVP, topics/threads, stickers, view-once media, quiet/scheduled sends, chat folders, history transfer, guest invitations, abuse reports, and advanced member restrictions (§30.4). |
| FR-EXT-02 | P2 | Encrypted recovery backup, independent key transparency, federation, explicitly visible archive/bot participants, and optional on-device assistance. |

### 0.2 Nonfunctional targets

| ID | Target | Verification boundary |
|---|---|---|
| NFR-SEC-01 | No service-held content keys or plaintext content | Inspect server databases, objects, traces, logs, push payloads, and media captures during the acceptance scenario. |
| NFR-REL-01 | Zero loss of acknowledged, unexpired envelopes on tested single-node failover in HA mode | Acknowledgement means durable commit under the selected synchronous replication policy; site loss follows the stated DR RPO. |
| NFR-PERF-01 | Healthy online delivery p95 ≤ 300 ms and p99 ≤ 1 s, acceptance-to-recipient durable receipt | Reference medium tier, intra-site RTT ≤ 50 ms, 20k sockets, measured direct/group mix; excludes offline clients and push provider delays. |
| NFR-AVAIL-01 | Messaging API availability ≥ 99.9% per calendar month | Valid supported requests, including failed planned upgrades; authentication and media are measured separately. |
| NFR-UX-01 | Usable first chat within 3 minutes in ≥ 90% of moderated new-user trials | Excludes organization account approval and unavailable identity/network services; test on Android and web separately. |
| NFR-A11Y-01 | Web WCAG 2.2 AA target; Android equivalent keyboard/assistive access | Automated checks plus manual core journeys; visual color alone never conveys security or delivery state. |
| NFR-DR-01 | Secondary-site RPO ≤ 5 min, RTO ≤ 1 h target | Measured quarterly with identity, secrets, ciphertext queues, objects, and safe protocol recovery. |

### 0.3 Deployment profiles

| Profile | Required connections | Notification behavior |
|---|---|---|
| Connected on-prem | All data/media hosted locally; allowlisted optional provider egress | Android UnifiedPush or opted-in FCM; web open-tab WebSocket, optional browser-vendor Web Push. |
| Restricted | Corporate LAN/VPN, private DNS/CA, local IdP/push/media | Android certified UnifiedPush distributor or approved foreground connection; web delivery while active. No vendor push. |
| Air-gapped | No internet route at runtime; offline registry/packages, local DNS/NTP/PKI/IdP | Same Android/web restrictions; closed browsers have no promised wake-up. Future iOS needs separately certified Local Push Connectivity. |

Federation, public phone-number discovery, SMS fallback, server-side content search/moderation, invisible recording, and server-side AI are outside the first release. Feature richness MUST preserve the security promise; see §25 for feature semantics.

## Table of contents

0. Product scope and release contract
1. Components
2. Identifiers and addressing
3. Cryptographic foundations
4. Identity, authentication, and device lifecycle
5. 1:1 encryption (Signal Protocol)
6. Group encryption (MLS)
7. Attachments
8. Client-side storage and key protection
9. Transport and wire protocol
10. Delivery semantics
11. Message content types
12. REST API
13. Server data model
14. 1:1 calling
15. Group calling
16. Push notifications
17. Disappearing messages, edits, deletes, receipts
18. Search
19. Policies, administration, audit
20. Rate limiting and abuse controls
21. Observability
22. Error model
23. Testing strategy
24. Reference implementation notes
25. Feature behavior and state convergence
26. Durable submission, wake-ups, and backpressure
27. Identity, group authorization, and recovery hardening
28. Browser security and capability contract
29. Operations, privacy, and release gates
30. Direct chats, groups, communities, and feature roadmap

---

## 1. Components

| Component | Tech | Responsibility | Sees plaintext content? |
|---|---|---|---|
| `enclave-gateway` | Spring Boot (Java 21+, virtual threads), WebSocket | Persistent device connections, frame routing, mailbox drain | No |
| `enclave-api` | Spring Boot, REST | Accounts, devices, prekeys, KeyPackages, groups roster/ACL, attachments, calls tokens, policies | No |
| `enclave-push` | Spring Boot (worker, no ingress) | Leases/retries durable PostgreSQL wake-up intents; optionally consumes `push:jobs` hints. Sends content-free UnifiedPush/optional FCM wakes; APNs and the separate local bridge follow in P1. Only worker with allowlisted vendor-push egress. | No |
| `enclave-admin` | Spring Boot + admin web UI | Admin console backend; aggregate metrics, policy, audit | No |
| Keycloak | Supported version pinned in release BOM | Account authentication, MFA, passkeys, federation, admin roles | No |
| PostgreSQL | Supported version pinned in release BOM (CloudNativePG) | Accounts, devices, keys, rosters, mailbox, audit | No (ciphertext only) |
| PgBouncer | CNPG Pooler | `rw` pooler (transaction mode) in front of the primary for all writers; `ro` pooler for freshness-tolerant aggregates/reads; push leases, authoritative checks, and outcomes use `rw`. Migrations bypass both. | No |
| Valkey (Redis-compatible) | Supported version pinned in release BOM | Presence keys, pub/sub signals (`mail:*`, `ctl:*`), optional `push:jobs` acceleration hints, rate limits, later call room registry | No |
| Object storage | SeaweedFS / Garage / Ceph RGW (S3 API) | Encrypted attachment blobs | No |
| coturn | 4.6+ | TURN/STUN relay for 1:1 calls (and SFU fallback) | No (SRTP only) |
| LiveKit | Pinned server/SDK compatibility set (P1) | SFU for group calls | No (frame-encrypted media) |
| ntfy | Pinned certified version | Self-hosted UnifiedPush distributor for Android | No (empty payloads) |
| Android client | Flutter + native Kotlin adapters + Rust core | UI, native lifecycle, encrypted protocol/storage | **Yes** |
| Web client | React + TypeScript + browser Rust/WASM adapter, subject to feasibility gate | Accessible browser UI; local cryptography/storage; no plaintext backend | **Yes** |
| iOS client (P1) | Flutter + native Swift adapters + Rust core | Later mobile target; extension work is deferred | **Yes** |

The backend is split into deployable modules but MAY run as a single Spring Boot application for small deployments (modular monolith, see `arf.md` ADR-003).

### 1.1 How the services communicate

`enclave-gateway`, `enclave-api`, `enclave-push` and `enclave-admin` MUST NOT call each other over HTTP, gRPC or any other synchronous request. They coordinate through durable state and asynchronous hints. Calls to infrastructure adapters (Keycloak, object storage, LiveKit, push providers, secrets) are permitted with bounded timeouts and retries. The no-direct-call rule applies only to the four Enclave backend apps:

| Channel | Mechanism | Carries | Guarantee |
|---|---|---|---|
| State | PostgreSQL via PgBouncer (`rw` for writers, `ro` for read-only consumers) | Envelopes, devices, keys, rosters, policies, revocations, audit | Durable, transactional |
| Signals | Valkey pub/sub | "Device has new mail", "close this device's socket", "policy changed" | Best effort. Lost signals recover through durable controls, authoritative request checks, mailbox polls, and periodic revalidation. |
| Jobs | PostgreSQL transactional outbox; Valkey stream as optional acceleration | Content-free wake-up and control intents | Durable intent with leased retries; provider delivery is best effort, duplicates are possible (§26). |

Keycloak sends lifecycle events to `POST /internal/keycloak-events` on `enclave-api` over mTLS. Authenticate the event producer, deduplicate event IDs, reject replay, and reconcile disabled/expired accounts periodically (§27). Later LiveKit webhooks are separately authenticated adapter inputs.

**Valkey key and channel catalogue**

| Name | Type | Written by | Read by | Content |
|---|---|---|---|---|
| `presence:{account}.{device}` | String, TTL 90 s | gateway (on connect, refreshed by pings) | gateway, api, admin before signalling | gateway pod id |
| `mail:{account}.{device}` | Pub/sub channel | gateway, api | the one gateway pod holding that device's socket | `1` (no content) |
| `ctl:{account}.{device}` | Pub/sub channel | api, admin | the gateway pod holding that device's socket | `REVOKED`, `KEYS_LOW`, `KEYPACKAGES_LOW`; hints never authorize an unsigned wipe |
| `ctl:broadcast` | Pub/sub channel | admin | every gateway pod | `POLICY_UPDATED` |
| `push:jobs` | Bounded stream, safe trim policy | outbox dispatch loop | consumer group `push-workers` | Opaque durable intent ID only; source of truth is PostgreSQL |
| `push:coalesce:{account}.{device}` | Expiring successful-attempt hint | push | push | Performance hint only; never proof that provider accepted a notification |

**Publishing rules and safety nets**

1. Persist envelopes and required push/control intents in the **same PostgreSQL transaction**. `afterCommit` may nudge dispatch but is never the only durable record.
2. Gateway/API signal online devices via `mail:*` after commit. A wake-up intent is also required for visible messages unless that device durably acknowledges within a short debounce. A stale presence key cannot suppress wake-ups indefinitely.
3. Workers lease intents with `FOR UPDATE SKIP LOCKED`, commit the lease before provider I/O, and persist success/retry outcomes. Worker restarts and a total Valkey loss are recovered by database polling.
4. Incoming calls have explicit type, TTL, and cancellation (§25); do not derive push type from a generic `urgent` Boolean. Security notices use their own policy. Receipts/typing do not wake devices.
5. All hints are content-free. Provider payloads use platform-required wrappers (§16), with no sender, group name, message body, or decryption key.

| Failure | Required outcome |
|---|---|
| Process dies immediately after mailbox commit | Committed outbox intent remains eligible; polling resumes wake-ups without a client reconnect. |
| Lost online signal | Connected gateway checks mailbox on keepalive; ordinary healthy recovery target is one 30 s interval. Network/server failure may take longer. |
| Worker dies before/after provider acceptance | Lease expires; retry may duplicate the push, never lose the message; client dedupe prevents repeated content/ringing. |
| Valkey unavailable or restored empty | Mailbox and intents remain durable; dispatch falls back to indexed PostgreSQL polling with bounded throughput. |
| Push token read is stale | Re-read current generation on primary; delete only the exact rejected token generation. |

**Why not Kafka.** Nothing here needs a distributed log. The mailbox needs per-device queues with point deletes (PostgreSQL), signals need sub-millisecond delivery to one specific pod (pub/sub), and push needs a small durable work queue (PostgreSQL intents, optionally accelerated by Valkey streams). Kafka is reconsidered only if a non-content domain-event backbone with many independent consumers is introduced (`arf.md` ADR-017).

---

## 2. Identifiers and addressing

| Identifier | Format | Scope | Notes |
|---|---|---|---|
| `account_id` | Application UUIDv4 | Immutable within deployment | Map a unique `(OIDC issuer, sub)` to this ID; never assume `sub` is a UUID. |
| `username` | `[a-z0-9._-]{3,32}` | Unique per deployment, mutable | Display/search handle. |
| `device_id` | uint32, 1..2^31−1 | Per account | Reserved before key bindings are signed; allocated monotonically; never reused. |
| `registration_id` | uint14 random | Per device install | Detects reinstall (stale sessions). |
| `DeviceAddress` | `account_id.device_id` | Global | Unit of delivery. |
| `group_id` | 32 random bytes (base64url) | Global | Opaque to server; equals MLS `group_id`. |
| `envelope_guid` | UUIDv7 | Global | Time-ordered; client dedupe key. |
| `message_id` | 16 random bytes | Inside ciphertext | Client-level message identity (edits/reactions reference it). |
| `call_id` | uint64 random | Per call | Carried inside E2EE CallMessages. |
| `room_token` | HMAC-SHA256 with typed, length-delimited context | SFU room name | Obscures raw group ID; operator correlation remains possible. |

The **unit of delivery is the device**, never the account. Every send fans out to an explicit list of device addresses.

---

## 3. Cryptographic foundations

### 3.1 Libraries

| Purpose | Library | Language | License |
|---|---|---|---|
| 1:1 protocol (PQXDH, Double Ratchet, sealed sender, fingerprints) | `libsignal` (`libsignal-protocol` crate) | Rust | AGPL-3.0 |
| Group protocol (MLS RFC 9420) | `openmls` + `openmls_rust_crypto` / `openmls_libcrux_crypto` | Rust | MIT |
| AEAD, HKDF, HMAC for app-layer crypto (attachments, storage, provisioning) | RustCrypto crates (`aes-gcm`, `hkdf`, `hmac`, `sha2`) | Rust | MIT/Apache |
| Password-based key derivation (desktop/web passphrase lock) | `argon2` | Rust | MIT/Apache |
| Frame encryption in calls | LiveKit client SDK E2EE (WebRTC encoded transforms) | Dart/Swift/Kotlin/JS | Apache-2.0 |

Protocol cryptography and transactional protocol state belong in the shared Rust core. Native Flutter uses a generated FFI facade; the React web client uses a browser-specific WASM/worker facade. Browser portability of the complete pinned dependency graph is an **M0 feasibility gate**, not an upstream guarantee. The backend contains public verification/parsing code but MUST NOT receive content decryption keys. General-purpose crypto libraries are permitted for TLS, signatures, token verification, and at-rest infrastructure encryption. [Upstream libsignal](https://github.com/signalapp/libsignal) documents its support boundary and change policy; see [sources](sources.md).

### 3.2 Primitives

| Use | Primitive |
|---|---|
| Identity keys (1:1) | Curve25519 key pair, XEdDSA signatures |
| Session key agreement (1:1) | PQXDH using the pinned libsignal profile; do not equate legacy Kyber wire formats with standardized ML-KEM |
| 1:1 message encryption | Double Ratchet; AES-256-CBC + HMAC-SHA256 (libsignal message format), HKDF-SHA256 |
| Post-quantum ratchet (1:1) | Sparse PQ / Triple Ratchet profile selected and interoperability-tested at M0; capability/version pinned, never silently downgraded (ADR-007) |
| MLS ciphersuite (GA) | `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (0x0001) |
| MLS ciphersuite (post-GA) | Reviewed supported hybrid PQ profile, selected by a separate ADR and interoperability gate |
| MLS signature keys | Ed25519, per device |
| Attachments | Versioned audited STREAM construction with 64 KiB chunks, unique nonces, authenticated final-chunk/length; SHA-256 of ciphertext |
| Local DB | SQLCipher (AES-256-CBC + HMAC-SHA512 page encryption) on native; app-layer AES-256-GCM on web |
| Device provisioning channel | X25519 ephemeral ECDH + HKDF-SHA256 + AES-256-GCM |
| Call media (1:1) | DTLS-SRTP (AES-GCM / AES_CM_128_HMAC_SHA1_80), fingerprints authenticated through E2EE signaling |
| Call media (group) | DTLS-SRTP hop-by-hop + AES-GCM frame encryption end-to-end with MLS-exported keys |

Post-quantum claims apply only to the certified direct-message protocol profile. MLS baseline groups and ordinary DTLS-SRTP direct-call key agreement remain classical; encrypted signaling alone does not make media key agreement post-quantum.

### 3.3 Key hierarchy (per account)

```
Account Identity Key (IK, Curve25519)       shared by all devices of the account,
│                                           transferred only via provisioning channel
├── Device d1
│   ├── registration_id
│   ├── Signed PreKey (SPK, rotated every 7 days, signed by IK)
│   ├── One-time PreKeys (OPK x100, consumed once)
│   ├── Kyber PreKeys (one-time x100 + 1 last-resort, signed by IK)
│   ├── MLS signature key (Ed25519)  + DeviceBinding = signature_IK(canonical deployment/address/key-purpose/version transcript)
│   ├── MLS KeyPackages (x100, single-use baseline)
│   └── Local storage master key (hardware-protected)
├── Device d2 ... (same structure)
└── Profile Key (32 bytes AES-256-GCM key, shared with contacts/groups to decrypt profile)
```

The shared account identity key is the selected Enclave multi-device design: contacts see one safety number per account, not per device. Device-level authenticity comes from (a) IK signatures over device prekeys and MLS device bindings and (b) device-list change notifications (§4.6).

---

## 4. Identity, authentication, and device lifecycle

### 4.1 Two layers of identity

| Layer | Authority | Proves | Used for |
|---|---|---|---|
| Account authentication | Keycloak (OIDC) | "This person is a legitimate org member, passed MFA." | Device registration, device linking authorization, admin console, REST calls requiring user presence |
| Cryptographic identity | Device-held keys | "This endpoint holds the account's IK / device keys." | All message encryption and verification |

Keycloak authenticates account actions; it does not supply E2EE keys. An additional device still needs existing-device consent and signed key bindings. An identity service or operator can attempt account reset/key substitution, affecting future traffic unless peers reject the identity change. No IdP reset recovers past plaintext by itself.

### 4.2 Device credentials

After registration, each device receives a **device credential** used for all subsequent server authentication (WebSocket and REST):

- `device_secret`: 32 random bytes generated by the client, sent once at registration over TLS; the server stores `HMAC-SHA256(pepper, device_secret)` (pepper from a KMS/Vault secret, not in the DB).
- Authentication: `Authorization: Basic base64(account_id.device_id:base64url(device_secret))` over TLS 1.3 with pinned CA.
- Post-GA hardening (ADR-011): replace the static secret with **DPoP-style proof-of-possession**, where the device signs a server nonce with a device-bound key with platform-specific assurance (Android Keystore / Secure Enclave later; reviewed browser proof-of-possession, without claiming a generic WebAuthn key signs arbitrary requests).

Rationale: OIDC access tokens (5-minute lifetimes) are a poor fit for long-lived WebSocket connections on intermittently connected mobile devices, and refresh tokens on device are a larger blast radius than a per-device revocable secret.

### 4.3 First device registration

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant C as Client (enclave-core)
    participant K as Keycloak
    participant A as enclave-api
    U->>C: Open app, "Sign in with SSO"
    C->>K: OIDC Auth Code + PKCE (Android system browser / web redirect; iOS session later)
    K-->>C: id_token, access_token (MFA enforced)
    C->>C: Generate IK, registration_id, SPK, 100 OPK, 100 Kyber + last-resort,<br/>MLS sig key, 100 KeyPackages, profile key, device_secret
    C->>A: POST /v1/devices/reservations (Bearer access_token)
    A-->>C: App account_id + reserved device_id + single-use reservation
    C->>C: Sign binding; persist pending enrollment + private keys before submit
    C->>A: POST /v1/devices/primary (Bearer access_token)<br/>{identity_key, registration_id, spk, opks, kyber_pks, mls_binding, key_packages, device_secret, device_name_enc}
    A->>A: Verify token, verify IK signatures on SPK/Kyber/binding,<br/>ensure no existing devices (else 409 -> link flow)
    A-->>C: 201 {device_id: reserved_id, device_list_version}
    C->>C: Mark pending enrollment accepted; open WebSocket
```

Android or web may be the first device. Web first-device creation requires explicit browser-trust acknowledgement and certified persistent encrypted storage; it cannot claim the native trust tier. There is no Android-phone prerequisite for web sign-in.

If the account already has devices, `POST /v1/devices/primary` returns `409 ACCOUNT_HAS_DEVICES` and the client offers (a) link via existing device or (b) **re-register** (new IK; all contacts will see a safety number change). Re-registration requires a Keycloak step-up (re-authentication + MFA) and is audit-logged.

### 4.4 Linking an additional device (QR provisioning)

The new device must obtain the account IK and profile key without the server learning them. An existing Android device scans the QR; an existing browser can scan or approve an equivalent session challenge only after comparing the transcript fingerprint on both devices. Manual pairing must preserve the same key/session binding and consent, not bypass it.

```mermaid
sequenceDiagram
    autonumber
    participant N as New device
    participant A as enclave-api
    participant G as enclave-gateway
    participant P as Primary/existing device
    participant U as User
    N->>N: Keycloak login (step-up MFA)
    N->>N: Generate ephemeral X25519 (eN)
    N->>A: POST /v1/provisioning/sessions (Bearer token, eN_pub)
    A-->>N: {provisioning_id, reserved_device_id, challenge, ws_url}
    N->>G: Open single-use authenticated provisioning WebSocket
    N->>U: Show QR/manual pairing challenge bound to deployment + session + eN + reserved address
    P->>P: User scans QR, confirms "Link Chrome on Linux?"
    P->>P: Generate eP; approve canonical bound transcript (§27.1)
    P->>P: K = HKDF(ECDH(eP,eN), transcript-bound context)
    P->>A: POST /v1/provisioning/sessions/{pid}/message<br/>{eP_pub, AES-GCM_K(ProvisionMessage)}
    A->>A: Store expiring ciphertext relay item + durable intent
    Note over A,G: Gateway reads shared relay state; no direct API-to-gateway call
    G-->>N: ProvisionMessage ciphertext
    N->>N: Decrypt: {IK pair, account_id, profile_key, provisioning_code, history_transfer_offer?}
    N->>N: Generate keys; sign bound address; persist pending enrollment before submit
    N->>A: POST /v1/devices/link {provisioning_code, keys...} (Bearer token)
    A->>A: Verify provisioning_code (single use, 10-min TTL, bound to account), verify signatures
    A-->>N: 201 {device_id: k}
    A->>A: Commit device-list version + own-device notices
    Note over A,G: Contacts compare signed lists on next send; no contact graph stored
    N->>N: Verified external join or authorized Add/Welcome (§6.6)
```

`ProvisionMessage` (protobuf, encrypted):

```protobuf
message ProvisionMessage {
  bytes identity_key_public  = 1;
  bytes identity_key_private = 2;
  string account_id          = 3;
  bytes profile_key          = 4;
  string provisioning_code   = 5;   // server-issued to the primary, proves primary consent
  bool read_receipts         = 6;
  HistoryTransferOffer history = 7; // optional (§4.5)
}
```

The `provisioning_code` is requested by the primary from `POST /v1/devices/provisioning-code` with the bound session/transcript (authenticated with its device credential), proving consent to exactly that destination and reserved address. The server requires both a valid Keycloak token for the account **and** a code issued to an existing device of the same account.

### 4.5 History transfer (optional, P1)

Device-to-device only. The primary exports the last N days (policy, default 30) of messages, encrypts them with a fresh 256-bit key into an archive blob, uploads it as an attachment (§7), and sends the key and pointer inside the `ProvisionMessage`. The blob is deleted after download or 1 hour. The server never stores history in a decryptable form.

### 4.6 Device list integrity

- Every change increments a monotonic device-list version and produces durable notices for the account’s own devices. Contacts compare fetched signed snapshots with their local snapshot before sending; the server does not keep a direct-conversation/contact graph to distribute notices. A server signature alone does not prevent a malicious operator from presenting inconsistent lists.
- Clients render “Ana linked a new device” after comparing contact lists, and a high-priority own-account notice with the locally decrypted device label where available; do not disclose an owner-private encrypted device name to contacts.
- Clients refuse to encrypt to a device whose SPK/Kyber/MLS binding signature does not verify under the contact's known IK.
- Post-GA: key transparency log (§19.4, ADR-012).

### 4.7 Device revocation

Triggers: user unlinks, admin revokes, Keycloak user disabled (event listener SPI → `enclave-api` webhook), inactivity expiry.

1. `devices.revoked_at` set and credential invalidated in one transaction; after commit the api (or admin) publishes `REVOKED` on `ctl:{account}.{device}`, and the gateway pod holding that socket closes it with code `4401 DEVICE_REVOKED`.
2. Prekeys, KeyPackages, push tokens deleted; mailbox purged for that device.
3. For each MLS group containing the device: server marks the group `pending_removal` (§6.7) and refuses new application messages for that group until a member commits the removal.
4. `DeviceListChanged` is emitted.
5. If the device reconnects with a valid TLS session but revoked credential, the server rejects access with `DEVICE_REVOKED`; an honest client clears local credentials, keys, history, and caches. Unauthenticated or unsigned instructions MUST NOT erase local state. Remote wiping remains best effort (FR-SEC-06).

---

## 5. 1:1 encryption (Signal Protocol)

### 5.1 Session establishment (PQXDH)

To send to account B for the first time, client A:

1. `POST /v1/keys/{B}/claim` with the desired active device selector returns a **pre-key bundle per device** of B:
   `{device_id, registration_id, identity_key, signed_prekey{id,pub,sig}, one_time_prekey{id,pub}?, kyber_prekey{id,pub,sig}}`.
   A replay-safe claim ID returns the original bundle on retry within its short TTL; a new claim atomically consumes one OPK and one one-time Kyber key per device (falling back to the last-resort Kyber key when exhausted).
2. A verifies SPK and Kyber signatures under B's IK. If B's IK differs from a previously stored IK, A MUST surface an identity-change notice; if B was **verified**, sending is blocked until the user re-confirms.
3. A runs PQXDH per device via `SessionBuilder::process_prekey_bundle` and stores a session per `(B, device_id)`.
4. The first message to each device is a `PreKeySignalMessage` carrying A's IK, ephemeral key, Kyber ciphertext, and used prekey IDs.

The shared secret derivation is (per PQXDH): `SK = KDF(DH(IK_A,SPK_B) ‖ DH(EK_A,IK_B) ‖ DH(EK_A,SPK_B) ‖ DH(EK_A,OPK_B)? ‖ KEM_SS)`, providing hybrid classical + post-quantum security for the initial key.

### 5.2 Ongoing messages

Each subsequent message uses the Double Ratchet: a symmetric-key ratchet per message (forward secrecy) and a DH ratchet each round trip (post-compromise security). If enabled in the pinned libsignal version, the sparse post-quantum ratchet adds periodic ML-KEM-based ratchet steps (ADR-007).

### 5.3 Multi-device fan-out ("Sesame")

A message from device A1 to account B is encrypted separately for:

- every active device of B, and
- every other active device of A (as a `SyncMessage{sent}` so A's other devices show the outgoing message).

The `SendRequest` lists each device and its `registration_id`. The server validates against the current device list and returns `409 DEVICE_MISMATCH` with `missing`, `extra`, and `stale` device IDs. The client then fetches bundles for missing devices, drops sessions for extra devices, re-establishes sessions for stale ones, and retries. This loop is the backbone of multi-device correctness.

### 5.4 Sealed sender (P1, FR-MSG-08)

- Each device periodically fetches a **sender certificate** from `GET /v1/certificate/sender`: `{account_id, device_id, identity_key, expires(24h)}` signed by the deployment's **server certificate**, itself signed by an offline **trust root** whose public key is compiled into the client build for that deployment.
- Sender encrypts the inner Signal message plus the certificate in an `UnidentifiedSenderMessage` to the recipient's IK.
- Delivery authorization uses the exact unidentified-access construction supported by the pinned libsignal integration, with reviewed vectors; no hand-written AES formula substitutes for that protocol.
- This feature uses an isolated REST endpoint without device Basic credentials, cookies, or an authenticated WebSocket. Sender certificates and recipient access checks are verified as specified by the selected profile.
- Sealed delivery is P1. P0 uses authenticated E2EE delivery with honest sender-metadata disclosure. The service can still correlate source IP, request timing, and credential issuance; do not promise anonymity.

### 5.5 Padding

Plaintext `Content` protobufs use a reviewed reversible pad-to-bucket profile (baseline 160-byte buckets, with unambiguous terminator and boundary vectors) before encryption, so ciphertext length reveals only coarse size buckets. Attachments are padded to the next size bucket (`max(541, 1.05^ceil(log_1.05(size)))`).

### 5.6 Safety numbers

`fingerprint = libsignal NumericFingerprintGenerator(iterations=5200, version=2)` over `(account_id_A, IK_A, account_id_B, IK_B)`, displayed as 60 digits and a scannable QR. Verified status is stored locally and synced to own devices via `SyncMessage{verified}`.

---

## 6. Group encryption (MLS)

### 6.1 Why MLS for groups

Signal's Sender Keys require O(N) pairwise messages to rekey after a removal and offer weaker post-compromise security. MLS provides O(log N) rekeying via a ratchet tree, formally analyzed security, and an IETF standard (RFC 9420). Targets: 1,000 interactive accounts at P0, 5,000 announcement accounts at P1. The real MLS size is the number of devices: enforce 5,000 and 25,000 leaves respectively, and publish benchmarked limits. Tree work can grow with proposal batches and sparse trees; full delivery still costs O(number of recipients). See ADR-006 and §27.

### 6.2 Model

- Every **device** of every member account is an MLS leaf (client).
- Leaf credential: `BasicCredential(identity = "account_id.device_id")` plus the `DeviceBinding` (IK signature over the canonical deployment/address/key-purpose/version transcript including the leaf signature key) carried in a custom leaf node extension `enclave_device_binding (0xF0A1, provisional private-use value subject to registry/capability validation)`.
- On processing any Add or external join, clients MUST verify the DeviceBinding against the account's known IK; failure means reject the commit and alert.
- `group_id` is random 32 bytes, generated by the creator.

### 6.3 Server role: Delivery Service (DS)

MLS requires that all members agree on the order of handshake messages. The server acts as an **ordering Delivery Service**:

| Message type | MLS framing | Server visibility | Server action |
|---|---|---|---|
| Commit | `PublicMessage` (signed, content visible to DS) | Proposal types, affected leaves, epoch, sender leaf | Validate epoch, validate sender authorization against ACL, update roster, fan out |
| Proposal (standalone) | `PublicMessage` | Same | Store as pending for the epoch, fan out |
| Application message | `PrivateMessage` | Epoch and group only | Fan out to current roster |
| Welcome | `Welcome` (HPKE to KeyPackage) | Recipient KeyPackage refs | Deliver to the specific new devices |
| GroupInfo (for external joins) | Signed `GroupInfo` with `ratchet_tree` extension | Public tree | Store latest per group |

Commits are sent as `PublicMessage` deliberately: the server must maintain the routing roster anyway (it cannot fan out without knowing recipient devices), and public commits let it validate membership changes and enforce role ACLs. Path secrets inside the UpdatePath remain HPKE-encrypted to tree nodes, so the server learns membership changes but never any group secret. Group metadata (name, avatar, description, disappearing timer) is sent in encrypted application messages (`GroupMetadataUpdate`, §11), not in the GroupContext, so the server never sees it.

### 6.4 Epoch ordering protocol

```
Client C (member, local epoch e) wants to commit:
  1. Build commit for epoch e (proposals by value + any pending by reference).
  2. POST /v1/groups/{gid}/commits {epoch: e, commit, welcome?, group_info}
  3. Server, in a single transaction:
       UPDATE mls_groups SET epoch = epoch + 1, group_info = :gi
        WHERE group_id = :gid AND epoch = :e AND status = 'active'
       -> 0 rows: 409 EPOCH_CONFLICT {current_epoch}
       -> 1 row: validate ACL, apply roster delta, enqueue commit to all
                 devices in OLD roster (including C), enqueue Welcome to new devices
  4. C merges its pending commit only after matching acceptance is known.
     A lost response requires commit-ID/digest lookup (§27.3), not a new commit.
     On a confirmed competing 409: discard pending commit, process accepted events,
     then rebuild if still needed. Sequence and role-state rules in §27 apply.
```

Application messages are tagged with their epoch. Process commits and applications through the durable group sequence (§27). Keep only bounded past-epoch **receive** state for reordering: default 2 epochs / 5 minutes. Expire it promptly; long-offline devices need retained commits or explicit resynchronization, not indefinite historical secrets. Revocation cannot stop a sender that is offline or using a stale epoch from encrypting; the server rejects such submissions until refreshed.

### 6.5 Group lifecycle operations

| Operation | Who may perform | MLS operation | Notes |
|---|---|---|---|
| Create group | Any account | Creator builds group, adds members' devices using claimed KeyPackages (`POST /v1/keypackages/claim`) | Server creates roster, ACL (creator = owner) |
| Add member | Admin/owner | Commit with Add proposals for every device of the new account | Server checks committer role |
| Remove member | Owner; admin for ordinary members | Commit with Remove for every leaf of the account | Admin peers/owner are protected by §30.2; removal may be paired with a ban/revoked invite. |
| Leave | Member | Standalone Remove proposal for own leaves; server marks `pending_commit`; next online member/admin commits it (auto-commit) | Clients auto-commit pending proposals they receive when they are the designated committer (lowest active `account_id.device_id` among online admins, falling back to any member after 30 s) |
| Key update | Any member | Empty commit with UpdatePath | Every device MUST self-update at least every 7 days and after app restore |
| Promote member to admin | Owner/admin under authenticated permissions | MLS commit updates role state, mirrored atomically | Cannot create an owner or grant permissions the actor lacks (§30.2). |
| Demote admin / transfer ownership | Owner | MLS commit updates role/owner state | Final-owner protection and explicit owner acceptance apply (§30.2). |
| Delete group | Owner | REST delete; server sends `GroupDeleted` system envelope to all | Clients archive locally |

### 6.6 Multi-device join and bounded state recovery

A newly approved device joins its account's existing groups with verified external commits only if the reviewed group profile supports credential binding, authenticated roles, and stale-leaf replacement. Otherwise an authorized member adds the device with a fresh KeyPackage/Welcome.

1. Fetch authorized group references and GroupInfo, corroborating the membership/role context with a trusted existing device where possible.
2. Verify credentials and supported extensions; construct a profile-valid join using the reserved active device address.
3. Submit with idempotent commit ID and expected epoch/sequence; server admission checks use authoritative device status and the mirrored role state.
4. Existing members independently validate the join under the previous authenticated group policy before accepting it.

Missing local state is not proof of a fork. First replay retained ordered events; after the catch-up window expires, use explicit verified rejoin. External commits alone cannot establish which divergent branch is correct. Quarantine genuine split views for peer corroboration or deliberate group recreation (§27.3). No server-held group secrets or automatic historical plaintext recovery are available.

### 6.7 Device revocation in groups

The server cannot commit (it is not a member). On revocation:

1. Server durably marks every affected group `pending_removal = {leaf refs}`, stops delivery to the device, and blocks application sends for affected groups until removal. Server availability gating is defense in depth, not a source of cryptographic authorization.
2. The next sender receives `409 PENDING_REMOVAL {leaves}`. An owner/admin must endorse/commit removal, unless the authenticated group policy explicitly delegated device-revocation removal authority to other members (§27.2). Sending remains blocked while no authorized committer is available; the server flag alone grants no role.
3. Honest clients encrypt new content under the accepted removal epoch; removed devices cannot derive its secrets. Ciphertext already encrypted under the old epoch remains exposed to members of that epoch, so stale submissions are rejected and re-encrypted after catch-up. Peers validate any removal authority as described in §27.

### 6.8 Large announcement groups

Standalone groups can use admin-only posting in P0, and every community announcement feed does so by default (§30). For P1 large announcement spaces (>1,000 accounts): clients enforce posting against authenticated role state, the server applies mirrored admission checks, and clients defer self-updates (randomized within 7 days) to limit commit storms. Commit fan-out cost is O(N) envelopes but each envelope is small; typical single-leaf tree updates scale logarithmically, while batched changes and sparse trees require measurement.

### 6.9 KeyPackages

- Each device uploads 100 single-use KeyPackages. Baseline Enclave refuses reuse; exhaustion waits for replenishment. A last-resort reuse extension is not assumed to be part of RFC 9420 or interoperable OpenMLS support; any future reuse profile requires its own review.
- `POST /v1/keypackages/claim {account_ids[]}` returns one KeyPackage per active device, consuming one-time packages atomically.
- Server sends `KEYPACKAGES_LOW` to a device when fewer than 20 remain.
- Lifetime: 90 days; devices rotate before expiry.

---

## 7. Attachments

### 7.1 Upload

```
1. Client: plaintext P, generate a fresh key K (32 B); obtain the nonce/header from the reviewed versioned STREAM implementation (§27).
2. Encrypt P using that construction with 64 KiB chunks; authenticate stream version, original length, chunk index, and final marker.
3. Pad ciphertext to bucket size (§5.5).
4. digest = SHA-256(ciphertext)
5. POST /v1/attachments/upload-form {size} -> {attachment_id, upload_url (presigned PUT, 15 min), resumable: optional multipart upload session (P1)}
6. PUT ciphertext to object storage.
7. Message carries AttachmentPointer{attachment_id, key K, versioned encryption header, digest, original size, content_type, file_name?, thumbnail(encrypted inline), blurhash, width, height, duration}.
```

### 7.2 Download

`GET /v1/attachments/{id}` → presigned GET URL (5 min). Client downloads, verifies digest **before** decryption, decrypts, verifies GCM tags per chunk, strips padding.

### 7.3 Server rules

- Objects stored in a bucket with no public access, server-side encryption optional (defense in depth only).
- Lifecycle: delete after 30 days (policy). Download counts are not tracked per recipient (metadata minimization); expiry is time-based.
- Content scanning is impossible server-side by design. Optional client-side scanning hooks are explicitly out of scope.

---

## 8. Client-side storage and key protection

| Platform | DB | DB key protection | Notes |
|---|---|---|---|
| Android | SQLite + SQLCipher (via `sqlcipher_flutter_libs`, accessed through `enclave-core`) | 256-bit DB key wrapped by Android Keystore (StrongBox if available), `setUserAuthenticationRequired` optional by policy | `FLAG_SECURE` per policy |
| iOS | SQLite + SQLCipher in App Group container | Keychain item `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, access group shared with Notification Service Extension | NSE must open DB read/write with file coordination (§16.3) |
| Desktop | SQLite + SQLCipher | OS keystore (Keychain / DPAPI / libsecret) or user passphrase (Argon2id m=64 MiB, t=3) | Passphrase required where OS keystore unavailable |
| Web | IndexedDB encrypted records; SQLite WASM/OPFS is optional after worker/concurrency validation | Reviewed record AEAD and passphrase/WebAuthn-PRF key wrapping where supported; non-extractable WebCrypto keys do not prevent hostile same-origin code from using them | Lower trust tier ([UI](UI.md) §8 and §28) |

The Rust core owns the logical schema and all protocol-state reads/writes through native/browser storage adapters of protocol state (sessions, prekeys, MLS state) to guarantee atomicity: **decrypt → persist plaintext + new ratchet state in one transaction → ack to server.** Never ack before commit.

Core local tables (simplified): `identity`, `sessions`, `prekeys`, `signed_prekeys`, `kyber_prekeys`, `mls_state` (OpenMLS storage provider), `contacts`, `conversations`, `messages`, `messages_fts` (FTS5), `attachments`, `reactions`, `receipts`, `call_log`, `outbox`, `processed_envelopes` (dedupe, 30-day window).

---

## 9. Transport and wire protocol

### 9.1 Endpoints

| Channel | URL | Auth |
|---|---|---|
| REST | `https://chat.<org>/v1/...` | Device credential (Basic) or Keycloak bearer (registration/linking/admin) |
| WebSocket | `wss://chat.<org>/v1/ws` | Device credential in `Authorization` header (native) or single-use ≤ 30 s exact-origin/device-bound `Sec-WebSocket-Protocol` ticket (web) |
| Provisioning WS | `wss://chat.<org>/v1/provisioning/ws` | Short-lived single-use ticket bound to the authenticated provisioning session; no long-lived URL secrets |
| TURN | `turns:turn.<org>:443?transport=tcp`, `turn:turn.<org>:3478?transport=udp` | Ephemeral HMAC credentials |
| SFU | `wss://sfu.<org>` | LiveKit JWT issued by `enclave-api` |

TLS 1.3 for client-facing HTTPS/WSS. Native clients pin approved SPKI keys via an authenticated configuration bundle with current/next overlap. Browsers use OS/browser certificate trust and cannot enforce native-style SPKI pinning from JavaScript. Private CA installation is an organization prerequisite. Internal TLS is required; see §28 and ARF deployment guidance.

### 9.2 WebSocket framing

Binary frames carrying protobuf. Request/response multiplexed by `request_id`. The following excerpts define field intent; FND-01 supplies the complete schema/types and generated compatibility fixtures.

```protobuf
syntax = "proto3";
package enclave.ws.v1;

message ClientFrame {
  uint64 request_id = 1;
  reserved 3, 7;                   // sealed WS and old typing relay are not P0 operations
  oneof body {
    SendRequest send           = 2;
    Ack ack                    = 4;
    GroupSendRequest group_send = 5;
    Ping ping                  = 6;
    // Encrypted typing uses send with transient_ttl_seconds.
  }
}

message ServerFrame {
  uint64 request_id = 1;            // 0 for server-initiated
  oneof body {
    Envelope envelope          = 2;
    SendResult send_result     = 3;
    QueueEmpty queue_empty     = 4;  // drain complete
    Directive directive        = 5;  // KEYS_LOW, KEYPACKAGES_LOW, WIPE, DEVICE_LIST_CHANGED, POLICY_UPDATED
    Pong pong                  = 6;
    Error error                = 7;
  }
}

message Envelope {
  enum Type {
    UNKNOWN = 0;
    CIPHERTEXT = 1;
    PREKEY_MESSAGE = 2;
    UNIDENTIFIED_SENDER = 3;
    MLS_PRIVATE = 4;       // group application message
    MLS_COMMIT = 5;
    MLS_WELCOME = 6;
    MLS_PROPOSAL = 7;
    SERVER_EVENT = 8;      // server-signed system events (DeviceListChanged, GroupDeleted)
  }
  Type type = 1;
  bytes guid = 2;                   // UUIDv7
  string source_account = 3;        // empty for UNIDENTIFIED_SENDER
  uint32 source_device = 4;
  bytes group_id = 5;               // MLS types only
  uint64 epoch = 6;                 // MLS types only
  bytes content = 7;
  uint64 server_timestamp = 8;
  bool urgent = 9;                  // priority hint, not notification kind
  uint64 group_seq = 10;            // required MLS processing sequence
  uint64 expires_at = 11;           // admission deadline / TTL in milliseconds
}

message SendRequest {
  string destination_account = 1;
  repeated DeviceMessage messages = 2;
  uint64 client_timestamp = 3;
  bool urgent = 4;
  reserved 5;                       // former online_only flag: not a P0 ephemeral path
  bytes submission_id = 6;           // 128 random bits; idempotent within origin
  uint64 device_list_version = 7;
  NotificationKind notification_kind = 8;
  uint32 transient_ttl_seconds = 10; // bounded encrypted typing/ICE; no push
}

message DeviceMessage {
  uint32 device_id = 1;
  uint32 registration_id = 2;
  Envelope.Type type = 3;
  bytes content = 4;
}

message GroupSendRequest {
  bytes group_id = 1;
  uint64 epoch = 2;
  bytes mls_private_message = 3;    // one ciphertext for all members
  bool urgent = 4;
  bytes submission_id = 5;
  NotificationKind notification_kind = 6;
}

enum NotificationKind { NONE = 0; MESSAGE = 1; CALL = 2; SECURITY = 3; }

message SendResult {
  bool ok = 1;
  repeated uint32 missing_devices = 2;
  repeated uint32 extra_devices = 3;
  repeated uint32 stale_devices = 4;
  string error_code = 5;            // EPOCH_CONFLICT, PENDING_REMOVAL, RATE_LIMITED, ...
}

message Ack { repeated bytes guids = 1; }
```

Group application messages are a single MLS ciphertext; the server fans out the same bytes to every roster device (excluding the sender device). This is the major bandwidth advantage of MLS over pairwise fan-out.

### 9.3 Keepalive and reconnection

- Client sends `Ping` every 30 s (foreground) / relies on OS push in background; server closes after 90 s of silence.
- Each `Ping` refreshes `presence:{account}.{device}` and makes the gateway run an indexed `EXISTS` on the device's mailbox; if anything is pending it drains immediately. This bounds the cost of a lost `mail:*` signal to one keepalive interval (§1.1).
- Reconnect with exponential backoff (1 s → 60 s, full jitter). On reconnect the server drains the mailbox oldest-first, then sends `QueueEmpty`.
- Graceful pod shutdown: gateway sends close code `4100 RECONNECT` with randomized delay hint to spread reconnect storms.

---

## 10. Delivery semantics

| Property | Guarantee |
|---|---|
| Durability | A `SendResult{ok}` means the envelope is committed to PostgreSQL (synchronous replication in HA mode). |
| Delivery | At-least-once per device. Envelope deleted only on device `Ack`. |
| Deduplication | Client keeps `processed_envelopes(guid)` for 30 days; duplicates are acked and dropped. |
| Ordering | Mailbox pagination uses stable `(server_ts, guid)` with recipient scope. MLS handshake/application processing follows a persisted per-group sequence; display uses bounded sender time with stable IDs (§27). |
| Expiry | Undelivered envelopes expire after 30 days (policy). Sender is not notified (no metadata leak); delivery receipts simply never arrive. |
| Store-then-notify | The gateway (or api) persists, then, after commit, publishes `mail:{account}.{device}` for online devices; the pod holding the socket drains. No content transits Valkey. |
| Offline wake-up | A durable intent is committed with the envelope; workers lease/retry content-free provider attempts (§16.4, §26). Duplicate wake-ups are possible. |
| Missed signal | Each client keepalive triggers a mailbox `EXISTS` check, bounding delivery delay to 30 s if a signal was lost (§1.1). |
| Transient | P0 `transient_ttl_seconds` queues short-lived ciphertext (typing ≤ 10 s, ICE ≤ 30 s), no push. A later ciphertext pub/sub path needs an ADR; content never enters ordinary Valkey hints. |

---

## 11. Message content types (inside encryption)

These are schema excerpts, not standalone compilable files. FND-01 defines the complete types, criticality/version rules, and generated bindings before code; feature additions in §25 must be represented in that schema.

```protobuf
syntax = "proto3";
package enclave.content.v1;

message Content {
  oneof body {
    DataMessage data = 1;
    SyncMessage sync = 2;
    CallMessage call = 3;
    ReceiptMessage receipt = 4;
    TypingMessage typing = 5;
    GroupMetadataUpdate group_metadata = 6;
    DecryptionErrorMessage decryption_error = 7;  // retry request
  }
  bytes sender_key_hint = 15;  // reserved
}

message DataMessage {
  bytes message_id = 1;
  string body = 2;
  repeated AttachmentPointer attachments = 3;
  Quote quote = 4;
  repeated Mention mentions = 5;
  Reaction reaction = 6;
  Edit edit = 7;
  Delete delete = 8;
  uint32 expire_timer_seconds = 9;
  uint64 timestamp = 10;
  bytes profile_key = 11;        // shared on first contact / rotation
  LinkPreview preview = 12;
}

message Edit { bytes target_message_id = 1; string new_body = 2; uint64 edited_at = 3; }
message Delete { bytes target_message_id = 1; }
message Reaction { bytes target_message_id = 1; string emoji = 2; bool remove = 3; }

message CallMessage {
  uint64 call_id = 1;
  oneof body {
    Offer offer = 2;
    Answer answer = 3;
    IceCandidates ice = 4;
    Hangup hangup = 5;
    Busy busy = 6;
    GroupCallUpdate group_call = 7;
    AdHocCallKey adhoc_key = 8;
  }
  uint32 destination_device_id = 9;  // 0 = all devices
}

message Offer { enum Type { AUDIO = 0; VIDEO = 1; } Type type = 1; string sdp = 2; }
message Answer { string sdp = 1; }
message IceCandidates { repeated string candidates = 1; }
message Hangup {
  enum Reason { NORMAL = 0; ACCEPTED_ELSEWHERE = 1; DECLINED_ELSEWHERE = 2; BUSY_ELSEWHERE = 3; NEED_PERMISSION = 4; }
  Reason reason = 1;
  uint32 device_id = 2;
}

message GroupMetadataUpdate {
  uint64 version = 1;             // monotonically increasing; highest wins, ties by sender leaf index
  string name = 2;
  string description = 3;
  AttachmentPointer avatar = 4;
  uint32 expire_timer_seconds = 5;
  bool announcement_only = 6;
  bool history_sharing = 7;
}

message SyncMessage {
  oneof body {
    SentTranscript sent = 1;       // own outgoing message mirrored to own devices
    Read read = 2;
    Verified verified = 3;
    Contacts contacts = 4;
    Configuration configuration = 5;
    CallEvent call_event = 6;      // answered/declined elsewhere
  }
}
```

---

## 12. REST API

All endpoints under `/v1`, JSON (keys as base64url) except where noted. Auth: `D` = device credential, `K` = Keycloak bearer, `A` = Keycloak admin role, `P` = provisioning session.

### 12.1 Accounts and devices

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/deployment-info` | Public | Non-user deployment metadata and supported versions; native trust comes from signed managed config. |
| POST | `/ws/tickets` | D | One-use browser socket ticket, exact origin/device, ≤ 30 s TTL. |
| POST | `/devices/reservations` | K | Reserve an address and single-use enrollment challenge; expire after 10 minutes. |
| POST | `/devices/primary` | K | Register first device (§4.3). |
| POST | `/devices/provisioning-code` | D | Existing device requests a single-use linking code. |
| POST | `/provisioning/sessions` | K | New device opens provisioning session. |
| POST | `/provisioning/sessions/{pid}/message` | D | Existing device delivers encrypted ProvisionMessage. |
| POST | `/devices/link` | K | New device registers keys with provisioning code. |
| GET | `/devices` | D | List own devices (names encrypted, decrypted client-side). |
| DELETE | `/devices/{deviceId}` | D | Unlink own device (cannot delete self via this route; use `/devices/self`). |
| DELETE | `/devices/self` | D | Unregister this device. |
| GET | `/accounts/{accountId}/devices` | D | Device IDs + registration IDs of another account (for fan-out). |
| GET | `/directory/search?q=` | D | Org directory search; returns `account_id`, username, encrypted profile pointer. |
| PUT | `/profile` | D | Upload encrypted profile blob + versioned profile key commitment. |
| GET | `/profile/{accountId}/{version}` | D | Fetch encrypted profile. |
| PUT | `/accounts/me/unidentified-access-key` | D | Upload UAK for sealed sender. |
| GET | `/certificate/sender` | D | Server-signed sender certificate (24 h). |

### 12.2 Keys

| Method | Path | Auth | Description |
|---|---|---|---|
| PUT | `/keys` | D | Upload SPK, OPKs, Kyber prekeys. |
| GET | `/keys/status` | D | Counts of remaining OPK/Kyber. |
| POST | `/keys/{accountId}/claim` | D; isolated UAK route P1 | Claim bundles for selected active devices once; replay-safe claim ID, no caching/prefetch. |
| PUT | `/keypackages` | D | Upload MLS KeyPackages. |
| POST | `/keypackages/claim` | D | Claim KeyPackages for accounts' devices. |

### 12.3 Messages

Messages are sent over WebSocket. REST fallback for constrained environments and background sends (including later iOS NSE):

| Method | Path | Auth | Description |
|---|---|---|---|
| PUT | `/messages/{accountId}` | D | P0 authenticated direct E2EE submission (body = `SendRequest` protobuf). |
| PUT | `/sealed/messages/{accountId}` | UAK only, P1 | Isolated credential/cookie-free sealed submission; separate rate limits and dedupe scope. |
| PUT | `/groups/{groupId}/messages` | D | Send group application message. |
| GET | `/messages?limit=100` | D | Bounded mailbox drain; account/device scope from auth, no cache. |
| DELETE | `/messages/{guid}` | D | Ack. |

### 12.4 Groups

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/groups` | D | Create group: `{group_id, initial_commit?, welcome, group_info, acl}`. |
| GET | `/groups/mine` | D | Groups of this account with latest `GroupInfo`. |
| POST | `/groups/{gid}/commits` | D | Submit commit (§6.4); `external=true` for external joins. |
| POST | `/groups/{gid}/proposals` | D | Submit standalone proposal (leave). |
| GET | `/groups/{gid}/acl` | D (member) | Read mirrored authenticated roles/version. |
| POST | `/groups/{gid}/invites` | D (authorized role) | Create an opaque scoped, expiring/revocable link; no identity bypass. |
| POST | `/groups/{gid}/join-requests` | D | Request membership; admission completes only after an authorized MLS Add. |
| DELETE | `/groups/{gid}/invites/{inviteId}` | D (authorized role) | Revoke future redemption, preserving authenticated invite-policy state. |
| GET | `/groups/{gid}/events?after_seq=` | D (member) | Bounded ordered catch-up with profile authorization. |
| GET | `/groups/{gid}/commits/{submissionId}` | D (authorized submitter/member) | Resolve uncertain commit acceptance by ID/digest. |
| DELETE | `/groups/{gid}` | D (owner) | Delete group. |

### 12.4a Communities

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/communities` | D | Create root announcement MLS group and versioned community descriptor (§30.3). |
| GET | `/communities/mine` | D | Authorized community references, mirrored membership/version, encrypted descriptor pointers. |
| GET | `/communities/{cid}/groups` | D (community member) | Only authorized/discoverable linked-group references; membership remains separate. |
| POST | `/communities/{cid}/links` | D (authorized community role) | Stage a subgroup link; requires subgroup-owner acceptance and both authenticated descriptors. |
| DELETE | `/communities/{cid}/links/{gid}` | D (authorized role) | Stage explicit unlink/detach, with subgroup-owner consent and recorded membership disposition. |
| POST | `/communities/{cid}/membership-operations` | D (authorized role) | Idempotent root/subgroup membership change with visible pending/rekey status. |

Community role changes and announcement posts use the root MLS group's normal commit/message endpoints. A membership operation is a tracked orchestration request, not unilateral server authority. All new mutating routes need submission IDs/version checks; exact request/response schemas are FND-01/COM-01 artifacts.

### 12.5 Attachments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/attachments/upload-form` | D | Presigned upload / tus endpoint. |
| GET | `/attachments/{id}` | D | Presigned download URL. |

### 12.6 Calls

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/calls/turn` | D | Ephemeral TURN credentials (§14.3). |
| POST | `/calls/group/{gid}/token` | D (member) | LiveKit join token for the group's call room. |
| GET | `/calls/group/{gid}/state` | D (member) | Is a call active? participant count only. |
| POST | `/calls/adhoc` | D | Create ad-hoc room (1:1 escalation); returns `room_token`, join token. |
| POST | `/calls/adhoc/{room}/token` | D | Join token for invited participant (server checks invite list hash). |

### 12.7 Push

| Method | Path | Auth | Description |
|---|---|---|---|
| PUT | `/push/apns` | D | `{token, voip_token, sandbox}` |
| PUT | `/push/unifiedpush` | D | `{endpoint_url}` (ntfy topic URL) |
| PUT | `/push/fcm` | D | `{token}` (connected profile only) |
| DELETE | `/push` | D | Remove push registration. |

### 12.8 Admin (separate ingress, `enclave-admin`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/users?q=` | A | Users with device counts, status, coarse last-seen (day granularity). |
| DELETE | `/admin/users/{id}/devices/{deviceId}` | A | Revoke device. |
| POST | `/admin/users/{id}/revoke-all` | A | Revoke all devices. |
| GET/PUT | `/admin/policies` | A | Org policy document (§19). |
| GET | `/admin/audit?from=&to=` | A (auditor) | Hash-chained audit entries. |
| GET | `/admin/health` | A | Aggregate metrics. |
| POST | `/admin/groups/{gid}/archive` | A (compliance) | Designate archived group; triggers archive agent join (§19.3). |

---

## 13. Server data model (PostgreSQL)

```sql
-- Accounts and devices -------------------------------------------------------
CREATE TABLE accounts (
    account_id          uuid PRIMARY KEY,                 -- application ID
    oidc_issuer         text NOT NULL,
    oidc_subject        text NOT NULL,
    next_device_id      bigint NOT NULL DEFAULT 1 CHECK (next_device_id BETWEEN 1 AND 2147483648),
    device_list_version bigint NOT NULL DEFAULT 0,
    UNIQUE (oidc_issuer, oidc_subject),
    username            citext UNIQUE NOT NULL,
    identity_key        bytea NOT NULL,
    uak_hash            bytea,                            -- unidentified access key (hashed)
    profile_version     text,
    profile_blob_ref    text,
    status              text NOT NULL DEFAULT 'active',   -- active | disabled | guest_expired
    guest_expires_at    timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    account_id          uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
    device_id           int  NOT NULL CHECK (device_id > 0),
    registration_id     int  NOT NULL,
    credential_hmac     bytea NOT NULL,
    name_enc            bytea,
    platform            text NOT NULL,                    -- android | ios | desktop | web | archive_agent
    mls_sig_key         bytea NOT NULL,
    mls_binding_sig     bytea NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    last_seen_day       date,                             -- day granularity only
    revoked_at          timestamptz,
    PRIMARY KEY (account_id, device_id)
);
-- Allocate accounts.next_device_id atomically on the primary; never recycle a reserved ID.

-- Signal prekeys ---------------------------------------------------------------
CREATE TABLE signed_prekeys (
    account_id uuid, device_id int, key_id int,
    public_key bytea NOT NULL, signature bytea NOT NULL,
    PRIMARY KEY (account_id, device_id),
    FOREIGN KEY (account_id, device_id) REFERENCES devices ON DELETE CASCADE
);
CREATE TABLE one_time_prekeys (
    account_id uuid, device_id int, key_id int, public_key bytea NOT NULL,
    PRIMARY KEY (account_id, device_id, key_id),
    FOREIGN KEY (account_id, device_id) REFERENCES devices ON DELETE CASCADE
);
CREATE TABLE kyber_prekeys (
    account_id uuid, device_id int, key_id int,
    public_key bytea NOT NULL, signature bytea NOT NULL,
    last_resort boolean NOT NULL DEFAULT false,
    PRIMARY KEY (account_id, device_id, key_id),
    FOREIGN KEY (account_id, device_id) REFERENCES devices ON DELETE CASCADE
);

-- MLS ----------------------------------------------------------------------------
CREATE TABLE mls_key_packages (
    account_id uuid, device_id int, kp_ref bytea,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, device_id, kp_ref),
    FOREIGN KEY (account_id, device_id) REFERENCES devices ON DELETE CASCADE
);

CREATE TABLE mls_groups (
    group_id        bytea PRIMARY KEY,
    epoch           bigint NOT NULL DEFAULT 0,
    next_group_seq  bigint NOT NULL DEFAULT 1,
    role_version    bigint NOT NULL DEFAULT 0,
    role_state_hash bytea NOT NULL,
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','quarantined','deleted')),
    group_info      bytea NOT NULL,                    -- latest signed GroupInfo incl. ratchet tree
    announcement    boolean NOT NULL DEFAULT false,
    archived        boolean NOT NULL DEFAULT false,
    pending_removal bytea[] NOT NULL DEFAULT '{}',     -- leaf refs of revoked devices
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mls_group_members (                        -- account-level ACL
    group_id   bytea REFERENCES mls_groups ON DELETE CASCADE,
    account_id uuid  REFERENCES accounts ON DELETE CASCADE,
    role       text NOT NULL CHECK (role IN ('owner','admin','member')),
    PRIMARY KEY (group_id, account_id)
);

CREATE TABLE mls_group_leaves (                         -- device-level routing roster
    group_id   bytea REFERENCES mls_groups ON DELETE CASCADE,
    account_id uuid, device_id int,
    leaf_index int NOT NULL CHECK (leaf_index >= 0),
    UNIQUE (group_id, leaf_index),
    FOREIGN KEY (account_id, device_id) REFERENCES devices,
    PRIMARY KEY (group_id, account_id, device_id)
);
CREATE INDEX mls_group_leaves_device_idx ON mls_group_leaves (account_id, device_id);

-- Mailbox ---------------------------------------------------------------------------
CREATE TABLE envelopes (
    account_id  uuid NOT NULL,
    device_id   int  NOT NULL,
    guid        uuid NOT NULL,                          -- UUIDv7
    server_ts   timestamptz NOT NULL DEFAULT now(),
    urgent      boolean NOT NULL DEFAULT false,
    expires_at  timestamptz NOT NULL,
    group_seq   bigint,                                 -- group processing order when applicable
    payload     bytea NOT NULL,                         -- serialized Envelope
    PRIMARY KEY (account_id, device_id, guid, server_ts)
) PARTITION BY RANGE (server_ts);
-- Daily partitions created by pg_partman; partitions older than maximum retention are dropped.
CREATE INDEX envelopes_drain_idx ON envelopes (account_id, device_id, server_ts, guid);
-- Per-row expiry is also enforced; partition expiry is not sufficient for call/typing TTLs.
-- Idempotency and outbox tables are specified in §26; this schema is illustrative, not a ready migration.

-- Attachments -------------------------------------------------------------------------
CREATE TABLE attachments (
    attachment_id uuid PRIMARY KEY,
    object_key    text NOT NULL,
    size_bytes    bigint NOT NULL,
    uploaded_at   timestamptz,
    expires_at    timestamptz NOT NULL
);   -- no uploader column: metadata minimization

-- Push ----------------------------------------------------------------------------------
CREATE TABLE push_registrations (
    account_id uuid, device_id int,
    kind text NOT NULL CHECK (kind IN ('apns','apns_voip','unifiedpush','fcm','local_push')),
    token text NOT NULL,                                -- encrypted at rest with server-managed key
    generation bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, device_id, kind),
    FOREIGN KEY (account_id, device_id) REFERENCES devices ON DELETE CASCADE
);

-- Policies and audit --------------------------------------------------------------------
CREATE TABLE policies (
    version     bigint PRIMARY KEY,
    document    jsonb NOT NULL,
    created_by  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    seq         bigserial PRIMARY KEY,
    ts          timestamptz NOT NULL DEFAULT now(),
    actor       text NOT NULL,                 -- admin username (admins are not anonymous)
    action      text NOT NULL,
    target      text,                          -- hashed account id for user targets
    details     jsonb,
    prev_hash   bytea NOT NULL,
    entry_hash  bytea NOT NULL                 -- SHA-256(prev_hash || canonical(entry))
);
REVOKE UPDATE, DELETE ON audit_log FROM enclave_app;
```

**Explicitly not stored in plaintext:** message content, direct conversation/contact lists, call history, and read state. The server necessarily handles group rosters and call-authorization mappings; attachment/push access and timing can be correlated while requests run. No durable sender field is stored for P1 sealed deliveries. IP-bearing infrastructure logs, if enabled, obey explicit short retention (§29).

---

## 14. 1:1 calling

### 14.1 Architecture

- Peer-to-peer WebRTC between the caller device and the answering callee device.
- **Signaling** (offer, answer, ICE candidates, hangup) travels as E2EE `CallMessage`s over the normal Signal sessions. The server sees only envelopes.
- **NAT traversal**: STUN/TURN via coturn. ICE candidates gathered from host, server-reflexive, and relay.
- **Media**: Opus (audio, 6–64 kbps adaptive, DTX, FEC), VP8 (default video) with H.264 hardware fallback, simulcast not needed for P2P.
- **Encryption**: DTLS-SRTP end-to-end between the two devices. The DTLS certificate fingerprints in the SDP are authenticated because the SDP is carried inside Signal-encrypted messages between identity-verified parties, so a TURN server or network attacker cannot MITM.

### 14.2 Call flow

```mermaid
sequenceDiagram
    autonumber
    participant A as Caller A (device a1)
    participant S as Server (mailbox/push)
    participant B1 as Callee B device b1
    participant B2 as Callee B device b2
    participant T as coturn
    A->>S: GET /v1/calls/turn
    S-->>A: {urls, username, credential, ttl}
    A->>A: Create RTCPeerConnection per callee device (lazy), createOffer
    A->>S: CallMessage{Offer} to b1, b2 (E2EE, urgent, + VoIP push)
    S-->>B1: envelope (+ VoIP/high-priority push)
    S-->>B2: envelope (+ push)
    B1->>B1: Report incoming call to CallKit / ConnectionService, ring
    B2->>B2: Ring
    A-->>B1: ICE candidates (short-TTL E2EE messages, trickle)
    A-->>B2: ICE candidates
    B1->>B1: User answers
    B1->>S: CallMessage{Answer} to a1
    B1->>S: SyncMessage{CallEvent: accepted} to b2
    S-->>A: Answer
    S-->>B2: CallEvent accepted -> stop ringing
    A->>S: CallMessage{Hangup ACCEPTED_ELSEWHERE} to b2
    A<<->>B1: ICE connectivity checks (direct or via T)
    A<<->>B1: DTLS handshake (fingerprints verified vs E2EE SDP) -> SRTP media
```

Rules:

- **Glare**: if A and B call each other simultaneously, the call with the numerically higher `call_id` wins; the other side sends `Hangup` for its own outgoing call and switches to an incoming-call prompt; media capture still requires explicit acceptance.
- **Busy**: a device in another call replies `Busy`; if all callee devices are busy, caller shows "Busy".
- **Timeout**: ring for 60 s, then `Hangup` and missed-call entry.
- **Ringing duration on push**: offers older than 60 s (server timestamp) are rendered as missed calls, never ring.
- **ICE restart** on network change (Wi-Fi ↔ cellular) via new offer with `iceRestart`.
- **Relay policy**: user setting "Always relay calls" (default ON for calls with external/guest accounts, OFF otherwise) forces `iceTransportPolicy: relay`, hiding device IPs from the peer.

### 14.3 TURN credentials (coturn REST API scheme)

coturn runs with `use-auth-secret` and `static-auth-secret` shared with `enclave-api`:

```
username   = "<unix_expiry>:<random_opaque_id>"     (expiry = now + 1 h; opaque id, not account id)
credential = base64(HMAC-SHA1(static_auth_secret, username))
```

Using an opaque random ID rather than `account_id` prevents TURN logs from identifying users.

### 14.4 Escalation to group call

Adding a third participant to a 1:1 call creates an **ad-hoc SFU call** (§15.6). Both existing participants receive `GroupCallUpdate{join ad-hoc room}` and transition from P2P to SFU (brief media interruption < 1 s, UI shows "Switching to group call").

---

## 15. Group calling (P1; after Android/web P0)

### 15.1 Architecture

- **SFU**: LiveKit (self-hosted, multi-node with Valkey for room state).
- **Transport**: WebRTC with DTLS-SRTP between each client and the SFU (hop-by-hop).
- **End-to-end media encryption**: every encoded audio/video frame is encrypted with AES-GCM using WebRTC encoded transforms (insertable streams) in the LiveKit client SDK's E2EE module before it reaches DTLS-SRTP. The SFU forwards encrypted frames without being able to decode them; it can still route based on unencrypted RTP headers and the small unencrypted frame header needed for codec packetization.
- **Simulcast**: 3 video layers (180p/360p/720p); SFU selects per subscriber based on bandwidth and tile size. Dynacast pauses unused layers.
- **Codecs**: Opus with RED for audio; VP8 simulcast default; AV1/SVC (L3T3) post-GA where hardware allows.
- **Limits**: 50 video participants (P1), 100 (P2, benchmark gated); 16 visible tiles; active speaker detection via audio levels (RTP header extension, unencrypted by design).

### 15.2 Key derivation from MLS

Group calls reuse the group's MLS state, so only current group members can derive call keys:

```
call_base_key(epoch) = MLS-Exporter("enclave/call/v1", group_id || call_id, 32)
frame_key(epoch, participant) = HKDF-SHA256(call_base_key(epoch), salt="enclave/frame",
                                            info=participant_identity, 32)
key_index = epoch mod 16    (LiveKit key ring slot)
```

- On additions/ordinary updates, install the new epoch generation before switching; a bounded 2 s overlap is permitted for receivers. On removal, pause publication immediately, install the new key, then resume with no deliberate old-key publication grace.
- Removed members cannot compute the new epoch exporter; old-key media remains exposed. Disconnect them at the SFU as defense in depth (§15.4).
- Every current group member can derive the exporter and the public participant inputs; per-participant HKDF keys provide domain separation, **not** sender authenticity against malicious members. Bind participant announcements to MLS sender credentials; stronger media-origin authentication needs separate signatures or a reviewed protocol. Never claim HKDF alone prevents impersonation.
- Graceful rotation is permitted for additions/ordinary updates. On removal, pause publication immediately until the new epoch key is installed; do not intentionally continue sending old-key media for two seconds. Reject retired generations and test slot wrap/reconnect so `epoch mod 16` cannot select stale keys.

### 15.3 Group call flow

```mermaid
sequenceDiagram
    autonumber
    participant A as Member A
    participant API as enclave-api
    participant L as LiveKit SFU
    participant B as Member B
    A->>API: POST /v1/calls/group/{gid}/token
    API->>API: Verify A is in roster, compute room_token = HMAC(gid||call_id)
    API-->>A: {jwt (identity=opaque participant id, room=room_token, ttl 5m), url}
    A->>A: Derive call key from MLS exporter (current epoch)
    A->>L: Connect (JWT), publish E2EE tracks
    A->>API: Group application message: GroupCallUpdate{call_id, started} (MLS, E2EE)
    API-->>B: fan-out + push "call started" (content-free)
    B->>B: Shows "Join call" banner / ring if call policy says ring
    B->>API: POST token
    B->>B: Derive same key from MLS exporter
    B->>L: Connect, subscribe, decrypt frames
```

### 15.4 SFU authorization and membership changes

- LiveKit JWT uses an **opaque participant ID** (random per call), not an account ID or display name. Clients authenticate that ID through E2EE announcements. The API also keeps short-lived token/device mappings for authorization/removal; a deployment operator can correlate those mappings and network metadata, so opacity is not anonymity.
- On MLS removal of a member, `enclave-api` calls LiveKit's server API `RemoveParticipant` for any participant tokens it issued to that account's devices in active rooms (token-to-device mapping kept in Valkey only for the call's lifetime).
- Room deleted automatically when empty for 60 s.

### 15.5 Screen sharing

- Desktop/web: `getDisplayMedia`; published as a separate track with its own E2EE key-ring use (same derivation, distinct track).
- Android: MediaProjection with a foreground service of type `mediaProjection`.
- iOS (P2): ReplayKit Broadcast Upload Extension; the extension must share key material via App Group keychain, and runs under tight memory limits (≈50 MB), so it uses a minimal LiveKit publisher.

### 15.6 Ad-hoc calls (not tied to an MLS group)

For 1:1 escalation or calls with an arbitrary set of contacts:

1. Initiator creates `call_id` and a random 32-byte `adhoc_key`.
2. `POST /v1/calls/adhoc {invitee_hashes}` → `room_token`, JWT.
3. Initiator sends `CallMessage{AdHocCallKey{key, room_token, participants}}` to each invitee over 1:1 Signal sessions.
4. On participant leave, the initiator (or the next participant in deterministic order) generates a new key and distributes it to remaining participants; ratchet to new key index.

### 15.7 What the server learns about calls

| Party | Learns |
|---|---|
| enclave-api | That a device requested a TURN credential or group call token for a group it is a member of; time. |
| coturn | Relayed IP pairs, byte counts, opaque usernames. |
| LiveKit | Opaque participant IDs, room token, IPs, bandwidth, active-speaker audio levels, track layer selections. |
| Never available to infrastructure under the E2EE threat model | Audio/video plaintext or encrypted group names. Operators may correlate opaque IDs with token issuance, devices, and network metadata; names are not anonymous to the deployment. |

Operators SHOULD set LiveKit and coturn log levels to avoid persisting IP-to-room mappings beyond operational need (retention ≤ 24 h).

---

## 16. Push notifications

### 16.1 Principles

Pushes carry **no message content, decryption keys, sender identity, or group identity**. Platform wrappers still apply: APNs alert/NSE uses `aps.alert` with a generic “New message”, `mutable-content: 1`, and an opaque event ID; a data-only `{t:m}` payload is not sufficient to invoke NSE. Android data wakes use an opaque type/event ID. Call pushes include only an opaque call-instance reference and expiry. Fetch/decrypt locally before rendering allowed details.

### 16.2 Per platform

| Platform / profile | Mechanism |
|---|---|
| iOS connected (P1) | APNs alert push with `mutable-content: 1` → Notification Service Extension (NSE) fetches `GET /v1/messages`, decrypts, rewrites notification. Calls: PushKit VoIP push → app MUST report to CallKit immediately (iOS requirement), then fetches and decrypts the Offer; if the offer is stale/invalid it ends the CallKit call. |
| iOS restricted/air-gapped (P1, entitlement gated) | **Local Push Connectivity** (`NEAppPushProvider`) on admin-configured SSIDs: a provider extension keeps a connection to the dedicated **local-push bridge** on the local network and triggers local notifications/calls. Requires the Apple entitlement and a certified SSID configuration/distribution path; MDM is the managed deployment option. Outside configured SSIDs, delivery happens on app foreground only. |
| Android connected | FCM (optional) high-priority data message, or UnifiedPush. |
| Android restricted/air-gapped | UnifiedPush via self-hosted **ntfy** distributor (app or embedded distributor), or Enclave foreground service maintaining the WebSocket (persistent notification). Admin policy selects the mode. |
| Desktop | Persistent WebSocket; OS notifications. |
| Web | WebSocket while tab open; Web Push (VAPID) via the browser's push service is **disabled** in air-gapped profile and optional otherwise (it involves the browser vendor's push infrastructure). |

### 16.3 iOS NSE constraints (P1)

- NSE has strict OS-controlled memory/time budgets; the cited approximate 24 MB / 30 s values are engineering test assumptions, not API guarantees. Benchmark on supported physical devices: `enclave-core` exposes a lean `decrypt_pending(limit)` entry point that avoids loading the full app state.
- DB access shared between app and NSE via App Group container; SQLite WAL mode with a cross-process file lock (`NSFileCoordinator`-guarded lock file) to prevent ratchet state corruption when both run simultaneously. The NSE skips decryption and shows a generic "New message" notification if it cannot acquire the lock within 2 s; the main app processes the envelope later.

### 16.4 Job intake, coalescing and delivery guarantees

`enclave-push` pulls leased intents from the primary (§26). It may consume `push:jobs` hints, but correctness does not depend on stream persistence or after-commit callbacks. A separate **local-push bridge** has ingress for future iOS provider connections; the push worker itself has no client ingress.

1. Claim an eligible intent with an expiring lease; check mailbox relevance, account/device status, call expiry/cancellation, and push-registration generation on the primary.
2. Fetch a sufficiently fresh token; re-read on primary if replica lag, absence, or generation mismatch makes the read uncertain. Provider I/O happens outside the database transaction.
3. Record provider acceptance or bounded exponential-backoff retry. Provider acceptance is not delivery acknowledgement. Dead/expired intents go to a sanitized dead-letter view with a reason and redrive controls.
4. A successful-attempt coalescing window may reduce visible-message wakes. It never acknowledges a failed attempt or suppresses a call cancellation/security event. Crash-after-acceptance can duplicate pushes; opaque event IDs prevent repeat local notification/call rendering.
5. Delete invalid registrations only with `(device, kind, generation, token)` equality. A rejected old token must not delete a replacement.
6. Calls expire at the ringing deadline (default 60 s); no push worker or delayed mobile wake may resurrect them. Receipts/typing never create visible notifications.

Android restricted mode uses a separately installed/certified UnifiedPush distributor or approved native foreground service. An embedded distributor has the same background-execution constraints as the app; it is not an OS restriction bypass. See [mobile delivery profiles](mobile.md).

---

## 17. Disappearing messages, edits, deletes, receipts

- **Disappearing**: timer changes are authenticated conversation events. Received timers start at earliest known own-device read; sender timers start on send, with optional absolute maximum lifetime and cleanup rules in §25.3. Enforce customer maximum retention independently of timer choices.
- **Edits**: `Edit` referencing `message_id`, original sender only within policy; retain local edit history only under the configured content-retention policy. Group administrators cannot rewrite someone else's message.
- **Delete for everyone**: author `Delete` and separately typed `ModerationDelete` (§30.2) reference `message_id`; recipients show the correct author/moderator tombstone. Best effort: modified clients or previously saved copies can retain content.
- **Receipts**: `ReceiptMessage{type: DELIVERY | READ | VIEWED, message_ids[]}` sent 1:1 (also in groups: sent as an MLS application message only if group size ≤ 100; above that, delivery receipts are suppressed to limit traffic).

---

## 18. Search

Local only. SQLite FTS5 with `unicode61 remove_diacritics 2` tokenizer (Romanian diacritics matter), indexed at insertion inside the encrypted DB. The browser uses a local encrypted index owned by the storage adapter; identical logical search behavior does not require identical SQLite persistence. Search results never leave the device.

---

## 19. Policies, administration, audit

### 19.1 Policy document

Signed by the server's policy key and delivered to clients via `Directive{POLICY_UPDATED}`; clients verify signature and enforce locally.

```json
{
  "version": 12,
  "messaging": {
    "disappearing": { "default_seconds": 604800, "min_seconds": 3600, "max_seconds": 2419200, "user_can_disable": false },
    "edit_window_seconds": 86400,
    "delete_window_seconds": 86400,
    "max_attachment_bytes": 104857600,
    "link_previews": false
  },
  "devices": { "max_per_account": 5, "inactive_unlink_days": 60, "allowed_platforms": ["android", "web"] },
  "security": { "screenshot_block": true, "app_lock_required": true, "app_lock_timeout_seconds": 300, "web_client_enabled": true },
  "calls": { "max_group_video": 50, "always_relay_external": true },
  "notifications": { "max_preview_level": "generic" },
  "read_receipts_default": false,
  "typing_default": false,
  "group_calls_enabled": false,
  "history_transfer_days": 0
}
```

This example is the Android/web pilot profile. Hardened deployments may set `web_client_enabled=false`; P1 enables group calls/history transfer only after their release gates. Policy is enforced by honest clients; it is a governance tool, not a cryptographic guarantee (a modified client can ignore screenshot blocking). This is documented to customers.

### 19.2 Audit log

Every authenticated administrative action, read/export of audit data, denied sensitive request, and policy mutation writes a canonical hash-chained entry (§13). Serialize chain append with a transaction/advisory lock; periodically sign and export checkpoints to an independently controlled append-only destination. A database-only chain can be rewritten by a privileged operator; independent checkpoints detect rewriting only after anchoring. Admin identities are **not** anonymized (accountability), user targets are hashed.

### 19.3 Compliance archive agent (P2)

A headless device type `archive_agent` (server-side process operated by the compliance team, holding its own keys in an HSM-backed keystore) that joins designated groups through a normal MLS Add committed by a group admin after admin-console designation. Clients render the archive member with a distinct, non-dismissible banner. The agent writes decrypted content to a customer-controlled WORM store. It cannot be added to 1:1 conversations in v1.

### 19.4 Key transparency (P2)

An append-only Merkle prefix tree (verifiable log) mapping `account_id → (IK, device list hash)`, with:

- Clients verifying inclusion proofs for every contact key they use and monitoring their own entry for unexpected changes.
- Signed tree heads gossiped between clients via E2EE messages (to detect split views), and optionally published to an independent auditor service run by the customer's security team.
- Reference designs: CONIKS, Parakeet / AKD (WhatsApp's open-source auditable key directory).

---

## 20. Rate limiting and abuse controls

Token buckets in Valkey, keyed by device (and by IP for unauthenticated endpoints):

| Action | Limit |
|---|---|
| Message sends | 60/min per device (burst 120) |
| Pre-key bundle fetches | 100/hour per device, 5/hour per target account per device |
| KeyPackage claims | 200/hour per device |
| Attachment upload forms | 50/hour per device |
| Directory search | 60/min per device |
| Provisioning sessions | 5/hour per account |
| TURN credentials | 30/hour per device |
| Group commits | 30/min per device per group |

Pre-key exhaustion attacks (draining a victim's OPKs) are mitigated by per-target limits and last-resort keys.

---

## 21. Observability

- **Metrics** (Prometheus via Micrometer): connections per pod, mailbox depth histogram, send/ack latency, drain duration, 409 rates (device mismatch, epoch conflict), push send success, `push:jobs` consumer-group lag and pending count, `XAUTOCLAIM` reclaims, keepalive-triggered drains (a rising rate means signals are being lost), prekey/KeyPackage pool depletion counts, LiveKit room/participant counts, TURN allocations.
- **Tracing** (OpenTelemetry): REST and WebSocket request spans. Span attributes MUST NOT include account IDs, group IDs, or IPs in clear; use `hash_id(x) = HMAC(daily_salt, x)[0..8]`.
- **Logs** (structured JSON → Loki): same identifier rules; no payload bytes ever logged; log retention ≤ 14 days by default.
- **Client telemetry**: none by default. Optional, opt-in, aggregate crash reports to an on-prem Sentry-compatible endpoint with PII scrubbing.

SLO alerts: delivery latency p99 > 1 s for 10 min; mailbox oldest undelivered (for connected devices) > 60 s; decryption error reports (clients send `DecryptionErrorMessage` to peers, and, only with explicit opt-in telemetry, a minimized counter to `/v1/metrics/decrypt-errors`) above baseline.

---

## 22. Error model

REST errors use RFC 9457 Problem Details:

```json
{ "type": "https://enclave/errors/device-mismatch", "title": "Device list mismatch",
  "status": 409, "code": "DEVICE_MISMATCH",
  "missing": [3], "extra": [], "stale": [2] }
```

| Code | HTTP | Meaning | Client action |
|---|---|---|---|
| `IDEMPOTENCY_CONFLICT` | 409 | Submission ID reused with different bytes | Preserve prior result; create a new attempt only for deliberately changed ciphertext |
| `GROUP_QUARANTINED` | 409 | Unverified recovery/split view | Stop sending; explicit verified group recovery |
| `DEVICE_MISMATCH` | 409 | Recipient device list changed | Fetch bundles / drop sessions, retry |
| `STALE_DEVICES` | 410 | Registration IDs changed (reinstall) | Re-establish sessions, retry |
| `EPOCH_CONFLICT` | 409 | MLS commit for old epoch | Process pending commits, retry |
| `PENDING_REMOVAL` | 409 | Revoked leaves must be removed first | Commit removal, retry |
| `ACCOUNT_HAS_DEVICES` | 409 | Use link flow | Show link UI |
| `DEVICE_LIMIT` | 403 | Max devices reached | Show device management |
| `NOT_GROUP_MEMBER` / `FORBIDDEN_ROLE` | 403 | ACL violation | Refresh group state |
| `RATE_LIMITED` | 429 | Retry-After header | Back off |
| `DEVICE_REVOKED` | 401 / WS 4401 | Credential revoked | Wipe and show signed-out state |
| `POLICY_VIOLATION` | 422 | e.g. timer below minimum | Show policy message |

---

## 23. Testing strategy

| Layer | Approach |
|---|---|
| Rust core | Unit tests; property tests (`proptest`) for ratchet persistence/ordering; fuzzing (`cargo-fuzz`) on all parsers (protobuf, MLS messages, provisioning); test vectors from RFC 9420 and libsignal. |
| Protocol integration | Headless multi-device simulator (Rust) driving N virtual accounts × M devices through randomized send/link/revoke/commit sequences against a real backend in Testcontainers; invariant: every message decrypts on every intended device exactly once. |
| Backend | JUnit 5 + Testcontainers (PostgreSQL, Valkey, MinIO-compatible store, Keycloak); contract tests for protobuf/REST; concurrency tests for prekey claiming and epoch CAS. |
| Load | Python (asyncio + `websockets`) and Gatling for WebSocket fan-out; target medium tier (20k connections, 10M msgs/day); LiveKit load tester for group calls. |
| Chaos | Kill gateway pods mid-drain, kill push pods holding pending jobs, partition Valkey, fail PostgreSQL primary: verify zero acknowledged-message loss within the HA failure model, recovery of every eligible durable intent, and safe duplicate provider attempts. OS/provider delivery is not guaranteed. |
| Clients | Flutter widget/integration tests and physical Android devices; React component/Playwright/browser-worker tests and manual screen-reader journeys; iOS extension/device tests in P1; call tests with network shaping (`tc netem`). |
| Security | External audit; SAST (Semgrep), dependency scanning (OSV/Trivy), DAST on REST, mobile static analysis (MobSF), secret scanning. |

---

## 24. Reference implementation notes

These notes are conceptual contracts, not production-ready library integration code. [tasks.md](tasks.md) assigns implementation and verification artifacts; exact APIs come from the release BOM.

### 24.1 Atomic MLS acceptance

Under a primary-database group row lock: validate sender/device status, expected epoch/sequence, authenticated role-state version, referenced proposals, and complete roster delta; then atomically persist the commit ID/digest, next group state, ordered commit fan-out/Welcome envelopes, and durable notification intents. A losing CAS must produce no fan-out or roster side effect. Clients remain the final MLS validators because the delivery service lacks epoch secrets and cannot validate the membership/confirmation tags. A lost HTTP response is resolved by commit ID/digest lookup, not by blindly discarding a possibly accepted commit (§27).

### 24.2 TURN credential issuance

```java
@RestController
@RequestMapping("/v1/calls")
@RequiredArgsConstructor
public class TurnController {

    private final TurnProperties props;   // secret, urls, ttl

    @GetMapping("/turn")
    public TurnCredentials turn(@AuthenticationPrincipal DeviceAddress me) throws Exception {
        long expiry = Instant.now().plus(props.ttl()).getEpochSecond();
        String opaque = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(SecureRandomHolder.bytes(12));          // not the account id
        String username = expiry + ":" + opaque;

        Mac mac = Mac.getInstance("HmacSHA1");
        mac.init(new SecretKeySpec(props.secret().getBytes(StandardCharsets.UTF_8), "HmacSHA1"));
        String credential = Base64.getEncoder()
                .encodeToString(mac.doFinal(username.getBytes(StandardCharsets.UTF_8)));

        return new TurnCredentials(props.urls(), username, credential, props.ttl().toSeconds());
    }
}
```

### 24.3 Core transaction contract

```text
receive envelope:
  acquire native cross-process lease / browser single-writer lease
  begin storage transaction
  if guid was processed: commit and acknowledge duplicate
  otherwise verify/decrypt through the pinned protocol implementation
  persist protocol state + message/event + local index + processed guid
  commit
  release lease
  acknowledge server
```

Keep protocol-state mutation inside the storage transaction, including libsignal/OpenMLS storage callbacks. Do not hold a database transaction across network I/O. Browser tabs, notification workers, and future iOS extensions cannot each independently mutate the same ratchet state. Poison envelopes have a bounded encrypted quarantine and user-visible recovery state; they must not block the mailbox forever.

### 24.4 Media SDK contract (P1)

Install an explicitly versioned key provider before publishing any track. Reject unsupported E2EE peers and stop publication during removal rotation or key-provider failure. Bind opaque participant IDs to authenticated MLS announcements. Keep sensitive call controls in Signal/MLS content; never assume SDK signaling, room metadata, or all data-channel modes are E2EE. Certify the selected SDK versions using [LiveKit encryption documentation](https://docs.livekit.io/transport/encryption/) and captured-media tests.

### 24.5 Mailbox drain query

```sql
-- Oldest-first drain for one device; partition pruning via server_ts lower bound (retention).
SELECT guid, payload
  FROM envelopes
 WHERE account_id = $1 AND device_id = $2
   AND server_ts > now() - interval '30 days'
   AND expires_at > now()
 ORDER BY server_ts, guid
 LIMIT 100;
```

### 24.6 Wake-up recovery contract

Enqueue the intent in the message transaction. A post-commit hint may wake a worker, but the worker periodically polls eligible rows even if every hint was lost. Lease expiry permits another worker to retry. Use the primary for authorization, leases, and write-after-read correctness. A stream `XACK` acknowledges only the acceleration hint; it never substitutes for persisting the durable intent outcome.

---

## 25. Feature behavior and state convergence

### 25.1 Conversation and content behavior

| Feature | Contract | Privacy and conflict behavior |
|---|---|---|
| Direct chats / Note to self | Encrypted text and typed content events; Note to self fans out only to own devices | No server conversation index; conversations appear from local history and encrypted own-device sync. |
| Replies and mentions | Reference original message ID; mentions reference stable account IDs and display from local profiles | Deleted/unavailable originals render an accessible placeholder; do not upload quoted plaintext separately. |
| Reactions | One active value per `(message, reacting account, emoji)` with an encrypted mutation ID | Idempotent add/remove; only the reacting account can retract its reaction. |
| Edits / deletes | Only the authenticated original author may edit or author-delete; a distinct group/community moderation-delete event is allowed for authorized roles (§30.2) | Queue bounded early mutations; tombstones prevent resurrection. Moderators cannot edit another author or silently impersonate them. |
| Files / media / voice notes | Same encrypted attachment protocol; optional waveform/thumbnail inside ciphertext | No server transcoding. Warn before opening executable/untrusted files; no auto-execution, bounded decoder resources, strip location EXIF by default. |
| Read / typing / presence | Read receipts off and typing indicators off by default; delivery status enabled | Presence is not a public employee-activity feed. Group receipts capped at 100 accounts; typing expires in 10 s and never wakes devices. |
| Mute / archive / pin / unread | Private account preferences, synced E2EE among own devices | An explicit user action wins over arrival of an old sync event; archive does not delete and is distinct from unread state. |
| Search / saved messages | Local search, local/E2EE bookmarks, local attachment gallery | Files that have expired remain as references with a clear unavailable state. Saving cannot silently override expiry policy. |
| Polls (P1) | Encrypted poll definition, immutable option IDs, voter-signed vote events and close event | Visible voters by default; no claim of cryptographic anonymous voting. Only the creator/authorized role closes a poll. |
| Scheduled send (P1) | Encrypted local outbox item with due time | Sending requires a device able to run at due time. UI says “will send when this device is online”; server scheduling stores ciphertext only and needs a separate review. |
| Link previews (optional, off) | Explicit client fetch with destination disclosure; locally generated preview encrypted in message | Never fetch third-party URLs server-side from user message bodies. Restricted profiles disallow external fetches. |
| Stickers (P1) | Locally bundled or org-hosted signed packs; custom media encrypted like attachments | No public sticker/CDN requests by default; validate decompression size and animation budgets. |

The encrypted content schema MUST add independently versioned event variants for these features. Reserve removed protobuf tags; never reuse them. Unknown noncritical events render “Update needed to view this item” and stay recoverable. Unknown security-critical semantics (identity, roles, membership, crypto suite) block the affected operation.

### 25.2 Own-device sync and history

Own-device sync contains settings, contacts/profile keys, conversation preferences, verification state, drafts where enabled, sent transcripts, read cursors, and call outcomes. Each mutation carries `(origin_device, mutation_id, monotonic_counter)` inside E2EE. Deduplicate by mutation ID; use counter + device ID as a deterministic tie-breaker for independent preferences. Wall clocks alone are not a conflict-resolution strategy. Security-sensitive identity/verification changes retain provenance and cannot be silently overwritten by an older snapshot.

A newly linked device receives current preferences and future traffic. P0 does **not** restore old messages from the server. P1 history transfer requires explicit source-device approval, a reviewed encrypted archive, a bounded date range, expiry, and a clear “Copying history” state. Never restore live ratchet/MLS state from a history archive. Imported content is historical and cannot trigger old edits, notifications, or calls as fresh events.

### 25.3 Disappearing content and notification cleanup

P0 timers: off, 1 hour, 1 day, 7 days, or 4 weeks, constrained by organization policy. Enforce a maximum content lifetime rather than a minimum lifetime when the goal is shorter retention. A received message's timer starts at first local view; encrypted own-device read sync carries the earliest known start time so devices converge. An optional absolute `not_after` deadline caps unopened retention. Use monotonic elapsed time while running and persisted deadlines across restart; show uncertainty after a major clock jump.

Delete expired message content, local search entries, previews, attachment keys/caches, drafts quoting the content, and scheduled local notifications. Prevent tombstones and idempotency markers from carrying plaintext. Secure deletion on flash/browser storage and another recipient's behavior cannot be guaranteed; key destruction and bounded retention reduce exposure. Screenshot prevention is best effort on Android and unavailable as a reliable browser control.

### 25.4 Calls and multi-device arbitration

Call state is explicit: `outgoing → ringing → connecting → active → ended`; alternative terminal outcomes are `declined`, `busy`, `missed`, `cancelled`, `answered_elsewhere`, and `failed`. Call IDs bind caller address, callee account, offer generation, and deadline inside E2EE content. Answers bind the offer generation and answering device. The caller accepts the first valid answer and sends authenticated cancellation to the remaining devices; late answers close locally without starting media.

A durable call offer has a 60 s ringing TTL; cancellation and accepted-elsewhere events are idempotent. Keep a local ended-call marker beyond maximum retry retention. Foreground and background delivery of the same event cannot ring twice. Camera starts only after explicit user action; audio/video permissions are requested at the action requiring them. On network change, authenticate ICE restart signaling and preserve the call ID. Never downgrade an E2EE call to transport-only media.

## 26. Durable submission, wake-ups, and backpressure

### 26.1 Idempotent send transaction

Add an opaque client-generated `submission_id` (128 random bits) to each send and commit request, distinct from the encrypted content's `message_id`. Scope direct submissions to the authenticated origin device; P1 sealed submissions need an independently reviewed unlinkable dedupe scope. Store a canonical payload digest, accepted recipient snapshot/version, accepted mailbox GUIDs, and result for at least mailbox maximum retention plus retry grace (default 31 days).

Under one transaction: validate active sender and recipient devices on the primary, compare device-list version, validate policy/size limits, insert the dedupe record, envelopes, and notification intents. The same ID and digest returns the original result without duplicate envelopes. The same ID with different bytes returns `409 IDEMPOTENCY_CONFLICT`. A device mismatch rejects the entire requested account fan-out; own-device mirroring is a separately idempotent submission. A retry that changes bytes uses a new submission ID. The encrypted message ID remains stable across re-encryption, so clients also deduplicate semantic content by authenticated sender + message ID.

Client outbox states: `draft → queued → encrypting → ready → submitting → accepted`, or `blocked_identity`, `blocked_membership`, `retry_wait`, `failed`, `cancelled`. Persist protocol advancement and ready ciphertext atomically before network submission. Retry **the same stored ciphertext** after uncertain transport success; never ratchet again merely because a response was lost. When membership/keys really change, explicitly build a new attempt and retire the superseded one.

### 26.2 Durable control and push intents

Minimal logical tables (create actual Flyway migrations before implementation):

| Table | Required columns / constraints | Retention |
|---|---|---|
| `submissions` | Origin, submission ID unique within origin, digest, result, created/expiry | 31 days default; no plaintext content |
| `notification_intents` | UUID, device, kind, opaque event ref, due/expiry, attempts, lease owner/until, state, last sanitized error | Delete success/expired records after bounded diagnostic grace (24 h default) |
| `control_events` | Device/account scope, control sequence, signed event, expiry, acknowledgement | Until applied/expired; next server request also revalidates authoritative state |
| `enrollment_reservations` | Account, reserved device ID, challenge digest, bound session/public key, single-use state, expiry | 10 minutes + short replay tombstone |
| `group_events` | Group ID, sequence unique within group, source epoch, commit/submission ID, digest, opaque MLS bytes, expiry | 30 days default catch-up window; no historical group secrets |

An outbox scanner is a background loop embedded in eligible backend applications, not a mandatory fifth HTTP service. Workers lease rows with `FOR UPDATE SKIP LOCKED`; expired leases are reclaimable. Bound batches and retry budgets; never hold locks during network I/O. Side effects are at-least-once, not exactly-once. Provider success means accepted by provider, and client `Ack` means locally persisted content; keep these metrics distinct.

### 26.3 Limits and overload

P0 defaults: 64 KiB UTF-8 text, 256 KiB encrypted envelope, 100 MiB attachment, 10 attachments/message, 5 devices/account, 100 envelopes/drain page, and 1 MiB total WebSocket frame. MLS commits may require a separately bounded larger frame based on leaf count; default 8 MiB only after M0 parsing/memory tests. Byte limits count decompressed size; reject oversized content before expensive parsing/crypto where possible.

Limit direct fan-out to the active device roster; rate-limit group fan-out by recipients/bytes as well as messages. Bound outstanding sends, gateway write buffers, local deferred mutations, key claims, invites, and per-device mailbox bytes (default 100 MiB). Reject new work with `429` or `503` and retry hints before resource exhaustion; never return accepted for discarded data. Server-side capacity admission cannot inspect encrypted content types, so clients also enforce type-specific limits.

Critical authorization reads (device revoke, account disable, membership, enrollment) use the primary. Dashboard aggregates may use replicas. Presence loss cannot grant access, and a Valkey outage must not disable abuse limits: use conservative local fallback budgets or temporarily reject costly endpoints.

## 27. Identity, group authorization, and recovery hardening

### 27.1 Enrollment and reset

Bind a provisioning challenge to deployment ID, account ID, session ID, both ephemeral public keys, reserved device address, protocol version, expiry, and a fresh nonce. Use canonical length-delimited signed/transcript bytes and domain-separated HKDF context. An existing trusted device approves exactly that transcript; the server cannot swap the destination key/session. Codes are single-use, rate-limited, and consumed atomically with enrollment. Persist new private keys and a pending enrollment ID before submission; registration/link endpoints resolve idempotent retries or an uncertain acceptance without generating a second identity/device. New devices cannot choose arbitrary device IDs. Reject untrusted deep-link hosts and never sign a generic key blob prompted by a remote web page.

Account recovery without any existing trusted device creates a new IK and resets the device list after SSO step-up. All previously verified peers block sending until re-verification. An administrator can reset account access but cannot recover old plaintext. The shared account IK allows a compromised linked device to forge account-authorized bindings until identity rotation; record this risk and provide “secure my account” rotation/revocation guidance.

Keycloak disable events need durable producer retry or an equivalent persisted event mechanism, replay-safe intake, and a reconciliation interval ≤ 60 s in the certified profile. Enclave requests use authoritative account/device status; sockets revalidate at least every 30 s. When the identity feed/reconciliation cannot establish freshness, enrollment and privileged account actions fail closed; define the deployment's allowed existing-messaging grace explicitly rather than promising instantaneous offboarding during an IdP outage.

### 27.2 Client-enforced MLS authorization

A public MLS commit and a server ACL are insufficient to protect an untrusted-server design from unauthorized additions/role changes. The application profile MUST authenticate account roles inside a versioned MLS group-context extension. Define its canonical encoding and require support in every KeyPackage capability. Every member evaluates a proposed membership/role change against the **previous** authenticated role state before accepting the commit. REST ACLs are transactional mirrors and admission optimizations, not independent authority.

Rules follow the explicit role matrix in §30.2: owner/admin may add members and promote eligible members, admins remove ordinary members, and owners protect/demote/remove peer admins and transfer ownership; ordinary members may update self and leave; linked devices may self-join only for their already-member account with a valid binding; only the current owner transfers ownership; no operation removes the final owner without a transfer. The server cannot mint new role authority. Admin-requested device removals are signed policy requests, but an authorized peer must endorse the MLS change under the group profile. Any-member removal of a server-flagged leaf is permitted only if the group's authenticated policy explicitly delegated that revocation authority; a flag alone is not enough.

Current members validate leaf credentials, bindings, role-state transitions, proposal references, tree/commit semantics, membership and confirmation tags using OpenMLS. The server verifies public signatures and structural admission checks only. A small reviewed public-message parser may be implemented in a sandboxed native adapter; do not invent an incomplete Java MLS stack. Availability gating by a malicious delivery service is unavoidable, while role changes cannot become silent content access.

### 27.3 Ordered commits, uncertain responses, and catch-up

Persist a monotonic `group_seq` across **both handshake and application** acceptances. A client buffers application events until all preceding required commits are applied. Retained `group_events` support authenticated, paginated `GET /v1/groups/{gid}/events?after_seq=`. Commit acknowledgement includes accepted sequence, resulting epoch, commit ID, and digest; `GET /v1/groups/{gid}/commits/{submissionId}` resolves a lost response. Merge a locally pending commit once the matching acceptance is known, and deduplicate its later mailbox copy.

On CAS conflict: fetch the accepted competing events before re-planning. Verify fetched GroupInfo against known credentials and transcript continuity where available; epoch numbers alone do not establish trust. A client ahead of a restored server must not simply overwrite the server with its “highest epoch”. A genuine split view requires peer corroboration/authenticator comparison or explicit group recreation; an external commit on a malicious branch is not proof of reconciliation.

A device outside the retained catch-up window shows “Rejoining secure group” and uses a verified external-join or authorized remove/add path. It must not silently reset identities or download group secrets from the server. The group profile must support external commit semantics, credential binding, stale-leaf replacement, and authenticated roles before this path ships; if the pinned OpenMLS profile cannot satisfy them, use authorized member Add/Welcome and update the ADR.

### 27.4 Cryptographic implementation gates

The suite/version/profile are explicit capabilities; unknown profiles block rather than downgrade. The Signal profile is selected from upstream specifications and pinned libsignal behavior, including ratchet capabilities; no “ML-KEM equals Kyber” assumption. Signing contexts bind deployment, account, address, key purpose, version, and expiry. Protocol primitives and canonical encodings use reviewed libraries and vectors.

Attachment streams must authenticate order, finality, original length, and header. Each attachment/re-upload attempt gets a fresh key/nonce domain; a resumed upload reuses already encrypted bytes without changing plaintext at a nonce. Verify digest and tags before opening any file; truncation, reorder, duplicate final chunks, changed lengths, and counter overflow fail closed. Do not define a new streaming AEAD scheme in application code.

## 28. Browser security and capability contract

The web client is a **P0 deliverable** and is enabled in the Android/web pilot profile. Hardened deployments may disable it, but web implementation, UX, and acceptance cannot be postponed behind iOS. Android uses Flutter; web uses a React/TypeScript shell and browser Rust/WASM adapters, subject to ADR-021 and the M0 proof. No server-decryption fallback is allowed if a dependency cannot run safely in browsers.

Browser delivery is lower trust: a malicious origin, extension, endpoint, or build pipeline can run code with access to decrypted content. CSP, SRI, signed manifests, and a service worker reduce accidental/update risks; same-origin bootstrap code cannot independently authenticate its own malicious replacement. Non-extractable WebCrypto keys stop key export APIs, not same-origin decryption requests. Show accurate wording and retain user choice.

Required browser implementation:

1. Link a browser installation as an explicit device; maintain one protocol writer in a dedicated worker with a cross-tab lease (Web Locks plus durable fencing). Race tabs/worker restart and test stale lease rejection.
2. Encrypt record values and local search material; do not keep plaintext in localStorage, URL fragments, navigation state, HTTP/service-worker caches, logs, or crash reports. A worker improves state isolation, not protection from hostile origin code.
3. Bootstrap authenticated REST access with memory-scoped credentials. WebSocket tickets are single-use, ≤ 30 s TTL, exact-origin/device-bound, returned from `POST /v1/ws/tickets`; redact the subprotocol from proxy logs. Never put long-lived credentials in URLs.
4. Use strict allowlisted CORS and WebSocket `Origin` checks, no third-party scripts/fonts/CDNs, strict CSP/Trusted Types where supported, safe content rendering, and no raw user HTML. Admin and user apps have distinct origins, storage, CSP, and authentication context.
5. Apply certificate trust via browser/OS settings. Document private CA import through managed browsers; JavaScript cannot bypass TLS validation or implement native certificate pinning.
6. Explain persistence limits (private browsing, storage eviction, cleared data). Request persistent storage where available; absence means reduced durability, not silent success. Detect loss before sending and require explicit re-linking.
7. Browser support at P0: current and previous stable Chromium and Firefox on managed Windows/Linux/macOS, conditional on M0 crypto/storage/media certification. Safari certification is P1; unsupported features are capability-gated with a visible reason.
8. Closed tabs have no guaranteed notifications in restricted/air-gapped profiles. Browser-vendor Web Push is opt-in connected-profile egress and requires separate approval in deployment policy, not application-user consent alone.

A web passphrase lock is the portable baseline. WebAuthn PRF unlock is optional where certified. Set inactivity lock to 5 minutes; locking clears in-memory plaintext/keys and visible notifications where the platform permits. Unlock usability, offline local history, and background fetch behavior must be tested together; locked clients may show generic notifications without decrypting.

## 29. Operations, privacy, and release gates

### 29.1 Bootstrap and upgrade contract

Expose `GET /v1/deployment-info` with no account data: deployment ID, allowed issuer/endpoints, supported protocol versions, capabilities, policy hash, build compatibility range, and connectivity profile. Native managed bundles authenticate these values with an organization trust root; an arbitrary QR code cannot install a new trusted root. Separate client-update, policy, enrollment, and sealed-certificate signing keys. Publish current/next trust material before rotation; expired/unknown trust produces actionable failure with no “ignore certificate error” button.

Pin every component/toolchain in a release bill of materials; no `latest` tags. Self-host fonts/assets, IdP metadata, TURN/STUN, object URLs, packages, registries, telemetry, and update manifests as required by profile. CSP/static artifact URLs and presigned S3 URLs must be reachable from corporate client networks, not just cluster nodes. Certify one object-store implementation first; other S3 compatibility claims need contract tests.

Use expand/migrate/contract database upgrades and N/N−1 client-server compatibility. Run migrations once with a separate role, readiness-gate new code, bound gateway drain, and document rollback constraints. The release advertises a minimum supported client/protocol version; unsupported crypto causes an update-required state, never plaintext fallback.

### 29.2 Privacy, administration, and abuse

Default retention: unacknowledged envelopes ≤ 30 days, encrypted attachments ≤ 30 days, diagnostic intent outcomes ≤ 24 h, infrastructure IP logs ≤ 24 h when enabled, sanitized application logs ≤ 14 days, security/admin audit 365 days unless customer policy overrides. Expired data must also age out of WAL/backups on the documented schedule; instantaneous deletion from immutable backups is not promised. Describe visibility and retention for every new metadata field.

Separate admin roles: helpdesk (device/status support), organization admin (membership/policy), security operator (incident/revocation), auditor (read/export audit), platform operator (infrastructure), and optional compliance officer (P2 archive settings). Enforce least privilege, step-up for reset/revoke-all/signing changes, reason fields, rate limits, and audited exports. Do not expose per-user conversation graphs or continuous employee presence dashboards. Hashing account IDs is pseudonymization, not anonymization; low-entropy values need keyed HMAC.

User blocking is local plus minimized server delivery controls; no server plaintext moderation. P1 abuse reports require explicit selection/preview of the messages and recipients receiving plaintext evidence. Guest expiry disables access, triggers group removals, and revokes tokens; it cannot erase content previously downloaded. Any bot/archive/assistant endpoint receiving plaintext is a visible participant and a separate trust decision.

SSRF-sensitive inputs include UnifiedPush URLs, object-store endpoints, identity issuers, link-preview destinations, webhook sinks, and discovery URLs. In P0 allow only operator-configured push hosts; validate scheme, port, DNS resolution and redirect target on each attempt, block unintended private/metadata endpoints, and apply an egress firewall. Never issue an arbitrary authenticated HTTP request to a client-supplied endpoint.

### 29.3 Production exit evidence

Android/web GA requires passing protocol vectors and parser fuzzing; real multi-device/offline/revoke/expiry scenarios; account/device/role authorization tests; Android process-death and notification tests; browser worker/tab/storage tests; keyboard/TalkBack/screen-reader journeys; load and single-node failure tests under published sizing; signed build/SBOM/offline-install verification; a safe restore drill; and an independent cryptographic/application security review with critical/high findings resolved. Record results and remaining risks in release evidence. Group calls and iOS have separate P1 gates and cannot delay Android/web P0.

---

## 30. Direct chats, groups, communities, and feature roadmap

### 30.1 Three first-class conversation experiences

| Experience | Purpose | Membership and posting | Encryption / P0 scope |
|---|---|---|---|
| Direct chat (1v1) | Private conversation between two accounts | Each account may have linked devices; message requests and blocking protect unsolicited contact | Signal sessions per recipient device, own-device sync, text/files/voice/replies/reactions/direct calls |
| Group | Collaborative discussion among selected accounts | Owner/admin/member roles; everyone posts by default, with admin-only mode available | Independent MLS group, client-enforced roles, add/remove/promote/demote, invites/approval, shared pins, moderation |
| Community | Organize a team, department, project, or interest space | An admin-only announcement feed plus optional linked discussion groups; community roles and subgroup roles are distinct | Root MLS announcement group and independent MLS groups for subgroups; P0 on Android and web |

For a first-contact direct message, show a message request with Accept, Block, and Delete locally actions. Until accepted, do not share profile keys/read/typing state or auto-download media; transport delivery acknowledgements do not imply user consent. Subsequent blocking suppresses notifications/receipts and future application delivery under the minimized block policy; unblocking does not silently replay blocked history.

A community is a product/domain entity, not just a renamed group. A standalone group may use admin-only posting without becoming a community. An organization administrator is not automatically a conversation/community member or content recipient. P0 communities target 1,000 accounts / 5,000 devices and 20 linked groups per community; each subgroup obeys the ordinary group limits. These are admission/benchmark targets, not measured capacity. P1 may raise announcement membership to 5,000 accounts / 25,000 devices only after scale evidence.

### 30.2 Roles, permissions, and moderation

Roles apply per space: group owner/admin/member, or community owner/admin/member. Default permissions are shown below. An owner is the ultimate conversation owner; “admin” does not confer deployment-administration privileges. Later custom permission sets must be subsets of the actor's grantable authority and become authenticated role-policy state before taking effect.

| Action in the current space | Owner | Admin | Member |
|---|---|---|---|
| Read content already delivered to own devices | Yes | Yes | Yes while authorized; removal cannot erase past copies |
| Post text/files/voice, reply, start an allowed call in a discussion group | Yes | Yes | Yes unless authenticated posting policy restricts it |
| Publish community announcements / post in admin-only groups | Yes | Yes | No; an acknowledgement, reaction, or permitted RSVP is not a content-post privilege |
| Acknowledge an assigned announcement / current rules | Own eligible response | Own eligible response | Own eligible response; no posting/admin privileges granted |
| Add/invite members, approve/reject join requests | Yes | Yes under invite policy | Request membership or share an already permitted link; cannot approve self |
| Remove/ban an ordinary member | Yes | Yes | Leave self only |
| Promote an ordinary member to admin | Yes | Yes under default policy | No |
| Demote/remove another admin | Yes | No by default | No |
| Remove/replace the owner, transfer ownership, delete the space | Transfer/delete only; must preserve ownership invariant | No | No |
| Change posting mode, invite policy, metadata/timer policy, shared pins | Yes | Yes within authenticated grant | No by default; ordinary members may keep private bookmarks |
| Edit another person's message | No | No | No |
| Issue a moderation-delete request for any post in this space | Yes | Yes within policy | No; author-delete of own messages is separate |

This matrix governs actions initiated within the current space. A linked subgroup may also accept the narrowly delegated parent-removal operation in §30.3 for a now-ineligible subgroup member, including a subgroup admin, while preserving final-owner constraints. That exception grants neither arbitrary demotion of a retained member nor subgroup read/admin access.

Admin promotion/demotion, removal, bans, invite policy, posting mode, and shared-pin permissions are versioned authenticated group-policy events. Clients validate the actor's authority at the operation's accepted sequence; caller timestamps or a changed server ACL cannot grant privileges. Demotion removes future administrative/posting powers but does not remove an otherwise retained member or erase their existing history. Re-evaluate queued posts/moderation actions after role changes; a demoted admin's delayed announcement is rejected.

Ownership transfer requires an existing eligible member's explicit acceptance, a fresh authenticated state version, and a single accepted role transition; the previous owner becomes admin unless explicitly choosing member status. The final owner cannot leave/be removed until transfer or deletion. Account disablement can still make a space unavailable: do not assign ownership silently through the server; use explicit trusted recovery/recreation.

`ModerationDelete` is distinct from an author's deletion: include target ID, authenticated actor, accepted role/policy version, mutation ID, and an optional encrypted reason. Honest clients hide content and show “Removed by a group admin”; they never rewrite authorship or claim that screenshots/exports disappeared. A user may remove a message locally without changing anyone else's copy. Role/member/moderation changes have an encrypted system timeline for participants; deployment audit records never include plaintext announcement or moderated-message content. A ban prevents ordinary invite redemption until an authorized unban; it is not merely a local block.

Posting restrictions apply to user content, not necessary MLS updates, removal acknowledgements, own-device sync, explicit scoped announcement/rules acknowledgements, or other protocol maintenance. Recipients enforce encrypted event types against authenticated permissions. Public type hints are untrusted admission aids: a member cannot label a new post “reaction” to bypass an admin-only feed. P0 community reactions are optional under authenticated policy (off by default); member comments/new posts are disabled. P1 replies or discussions use an explicitly linked discussion group with its own membership, not an unnoticed exception to admin-only posting.

### 30.3 Community structure, membership, and security

Each `community_id` is an opaque random ID bound in a versioned community descriptor to one root `announcement_group_id`. The root MLS group contains community members' active devices and authenticates community roles, encrypted name/avatar/description/rules, posting policy, and the authority used to approve scoped subgroup links. Each subgroup has an independent MLS context, roles, membership, history, and keys. A P0 subgroup has at most one active parent community; community roots cannot be linked as subgroups, and nested communities are not supported. Never reuse the root exporter or a single community-wide content key to encrypt every subgroup.

Community owners/admins can create the community, publish announcements, manage community membership, and propose adding/removing linked groups. Linking an existing group requires both a community-admin proposal and explicit subgroup-owner acceptance, authenticated in their respective group states with an operation ID/version. Community admins do not automatically gain subgroup membership, subgroup admin rights, or old content; those require a normal authorized membership/role change in that subgroup.

P0 linked subgroup members are a subset of community membership. Existing standalone groups can link only after their members explicitly accept community enrollment; linkage cannot silently add people to the root announcements or expose subgroup history. Joining a community enrolls the approved account in the root announcement group, not every subgroup. Only eligible joined users see approved discoverable subgroup listings; private subgroup listings/descriptors are restricted to authorized members/invitees and explicitly authorized linkage managers. Private link descriptors are not broadcast to the whole root feed; distribute them through existing E2EE recipient/group channels with authenticated authority/version proofs. Any group label shared with a linkage manager needs subgroup-owner approval and conveys no message or roster access. Do not fetch subgroup titles, rosters, or content for an unauthorized account merely because it belongs to the parent.

A subgroup may authenticate a **narrow parent-revocation delegation** at link time: validated community removal can remove the account's subgroup leaves, but cannot add readers, promote subgroup admins, or change subgroup content policy. Peers must verify the community-role/membership transition and link delegation from authenticated root state; a server-maintained parent ID alone is insufficient. Define and review these cross-group proofs in COM-01 before linked communities ship. If a group does not accept the delegation, it remains standalone rather than advertising parent-removal guarantees it cannot enforce.

Community removal/leave is an idempotent multi-step operation: validate authority and owner-transfer constraints; mark affected root/subgroups pending on the primary; remove all account devices from the root; obtain valid removal commits for every linked subgroup; cancel access/tickets/routes; then finalize. Block affected space sends while required removals are pending. An unavailable authorized committer yields visible “Removal pending—updating secure groups”, not false atomic success. No new root/subgroup epoch content is delivered to the removed account once each removal is accepted. Already encrypted old-epoch content stays subject to the limitations in §6.7.

Refuse voluntary community removal/leave that would strand a final subgroup owner until ownership transfers or that subgroup is deliberately deleted/detached under policy. Organization disablement takes precedence over availability and can quarantine affected groups. Unlink/detach requires explicit community/subgroup authority and a stated membership disposition; it cannot silently keep a removed person eligible through a stale link.

Server mirrors: `communities` (opaque IDs/root reference/version/status), `community_members` (account-level role/version), `community_group_links` (group IDs, visibility, accepted link/delegation versions), `join_requests`/`invite_links` (bounded lifecycle), and `membership_operations` (idempotent pending/completed steps). This adds observable relationship metadata; document it in the ARF. Names/descriptions/rules and announcement bodies stay encrypted. Routing cannot claim private group/relationship metadata equivalent to Signal's private-group implementation.

Group/community invitation links are high-entropy, scoped, expiring, revocable, and hashed at rest; redact redemption secrets from access logs and browser history where feasible; they do not bypass SSO, organization/guest eligibility, bans, or approval. Default requires admin approval. A join request grants no keys, feed, roster, or old history until an authorized Add/Welcome is committed. Ordinary group/community user consent is explicit unless customer policy permits managed group enrollment; parent linkage never silently creates consent to a new root audience. Newcomers receive future content plus explicit permitted current metadata and pin references; old-history transfer remains P1 and must never restore live protocol state. Pinning an old message cannot silently disclose its body/attachment key to a new member—require a separate deliberate re-share.

### 30.4 Useful feature matrix

The references in [sources.md](sources.md#product-feature-inspiration) are inspiration for product behavior, not a claim that all three apps offer each feature or use the same security model. P0 items are requirements for both Android and web; P1 items follow after the initial secure release. iOS remains later scope.

| Feature family | P0 Android/web | P1 expansion | Required security/usability behavior |
|---|---|---|---|
| Everyday messaging | 1v1, Note to self, discussion groups, communities, replies/reactions/mentions, edits/delete requests | Topics/threads within a group | Topics share their parent membership by default; private audiences require separate groups/keys. |
| Group/community controls | Add/remove, promote/demote under role matrix, ownership transfer, admin-only posting, join approvals, revoke links, member bans | Custom admin grants, per-member send restrictions, slow mode | Authenticated policies and client validation; demotion/removal stops queued unauthorized actions. |
| Organization | Private conversation pins/bookmarks, shared message pins, archive/mute/unread, unread catch-up/return position, local search and media gallery, per-chat themes/wallpapers | Private chat folders/custom filters, quiet/silent send, local scheduled send/reminders | Shared pins are events visible to the space; private bookmarks/folders are E2EE own-device preferences. |
| Files and expression | Encrypted photos/files/voice notes, ordered photo albums/captions, voice playback speed, safe bold/italic/code/quote formatting | Stickers, approved bundled GIFs, view-once photo/video, optional local transcription | No third-party media search or cloud transcription by default; view-once is best effort, not screenshot-proof. |
| Sharing | Explicit forwarding/copy/share with destination review and a “Forwarded” marker; bounded multi-message copy/forward/save/delete | — | Forwarding intentionally discloses selected plaintext to new recipients; omit source space identity unless explicitly shared and allowed. |
| Collaboration | Shared pins/rules, community announcements with explicit acknowledgement requests, optional policy-controlled reactions | Polls/quizzes, events/RSVP, linked discussion replies | No anonymous-vote claim; response permissions do not grant free posting. Event time zone, cancellation, and reminders sync E2EE. |
| Privacy | Default E2EE in all conversation types, identity checks, app lock, disappearing messages, message requests/blocking, generic previews, mentions-only mode and timed snoozing | Sealed sender, view-once controls, stronger recovery/verification options under their own gates | No cloud-chat mode with weaker content protection to mimic another product; no claim of forced remote erasure. |
| Calls | Direct audio/video, multi-device answer arbitration, relay option | Group audio/video, screen sharing, call links for authenticated invited members | No public anonymous room entry, media downgrade, or hidden recording recipient. |
| Community onboarding | Rich descriptions/purpose/contact links, welcome/about, versioned rules acknowledgement, eligible group recommendations, private newcomer checklist | Optional localized/custom onboarding templates | Onboarding completion is not an authorization token; private subgroup recommendations require existing eligibility. |
| Recovery/sync | Current preferences and future messages on linked devices | Explicit bounded history transfer | No default plaintext cloud history and no silent old-key/state restoration. |

Forwarding, shared pinning, and moderation add typed encrypted events to FND-01's schema. A forward is a new message with a new ID and target-appropriate encryption; it cannot circumvent target posting restrictions. Retention/export policy still applies to honest clients. Shared pins expire or disappear with their target, cannot resurrect deleted content, and show unavailable references on devices without the original history.

Events/RSVP and polls are bounded encrypted collaboration objects with authorized creator/admin actions, stable IDs, mutation counters, cancellation/close states, and local notification cleanup. Visible ballots are the initial poll model; cryptographic anonymity or verifiable voting needs a separate reviewed design. View-once media is P1: suppress normal history/export/cache retention and clear keys/previews after view/expiry; a recipient can still copy or record content outside the honest app. Sync a consumed marker among own devices, but do not promise a globally single view across devices that are simultaneously offline.

### 30.5 Acceptance scenarios and task mapping

- A group owner adds two users, an admin removes an ordinary member, promotes another member to admin, and the owner demotes that admin. Permission changes appear consistently on Android and web; a member cannot promote self or remove the owner.
- An owner transfers ownership with acceptance and can then leave. A last-owner leave/removal is blocked with an actionable transfer flow.
- A community admin publishes an announcement; an ordinary member cannot publish, edit an announcement, or spoof a reaction as a post. Allowed protocol maintenance continues in read-only feeds.
- An explicit acknowledgement works with read receipts disabled, syncs once per account despite two devices/offline retries, and never appears as a member post. Only named authorized reviewers receive individual responses; edits/rules revisions require a fresh acknowledgement.
- Community onboarding resumes across Android/web, hides ineligible/private groups, requests updated-rules acknowledgement visibly, and never makes checklist completion or a recommendation an automatic membership grant.
- An existing group links only after both authorities and prospective root members consent; a community admin outside the subgroup cannot read its content.
- Join links expire/revoke and require SSO/approval; banned members cannot rejoin through an old link. Pending requests expose no encrypted feed or subgroup metadata.
- Community removal is tested during subgroup-admin outage and partial commit success. Affected sends stay gated; retries resume the same operation; no new-epoch content reaches removed devices.
- A moderator removes a post with the correct tombstone, cannot edit its author, and cannot resurrect it with a later pin/forward event. A new member sees an unavailable old pin unless someone explicitly re-shares content.

Implementation mapping: FND-01/02 define and prove the profile; GRP-01/02/03 implement group roles/events/UX; COM-01/02 add communities, announcement/rules acknowledgements, newcomer onboarding, and cross-group operation evidence; FEAT-01/02/03 cover albums, bounded batch actions, descriptions/themes, member discovery, notification modes, catch-up, and fast accessible actions; EXT-01/03 cover P1 collaboration/organization features. All enter REL-01 requirement coverage and independent security review. Community scope extends M2/P0; no iOS or SFU prerequisite is introduced.


### 30.6 Explicit announcement acknowledgements (FR-COM-02, P0)

A community owner/admin may enable **Request acknowledgement** on a particular announcement; it is off by default. Members deliberately select “I acknowledge this announcement”. Delivery, opening, scrolling, a read receipt, or a notification interaction never creates that response. Acknowledgement records an explicit account action, not proof of reading, comprehension, or legal acceptance. Disabling ordinary read receipts does not disable this separate, clearly explained action.

The encrypted request binds `request_id`, community/root IDs, announcement message ID, content revision/digest, request revision, eligible audience snapshot/version, optional due time, expiry, and named reviewers. Default reviewers are the publishing admin and community owner, deduplicated; up to 10 current authorized owner/admin accounts may be explicitly selected before publishing. The member sees who receives their response. Reviewers see acknowledged/pending/late/no-longer-required states and counts derived on their endpoints; ordinary members see their own state. Do not create passive read tracking, an organization-wide employee-activity dashboard, or plaintext server acknowledgement reports.

An acknowledgement is a typed encrypted response, not a post/comment in the read-only feed. Deliver it through existing pairwise Signal sessions to the named reviewers' active devices, plus E2EE own-device sync. It includes a mutation ID, request/content revisions, responder identity, and only the required response metadata; never copy the announcement body. Validate sender identity, eligibility and request versions, and current reviewer role. Bound fan-out by the reviewer/device limits; ordinary routing metadata remains observable to infrastructure. Reuse the normal submission/outbox contracts, not an unauthenticated public response endpoint.

Deduplicate by `(community, request_id, request_revision, content_revision, responding_account)` across linked devices and retries. Persist the pending response before submission; show “Pending sync” offline and “Acknowledgement sent” only after durable acceptance for the required reviewer fan-out. Late valid responses may be marked late while the request remains active; content/request expiry or withdrawal rejects new responses. A reviewer being promoted later does not receive historical responses automatically; reviewer-set changes create a new visible request revision. Removed/demoted reviewers receive no new responses, although previously delivered copies cannot be remotely erased.

The eligible audience is fixed at publication; later joiners are not silently required to acknowledge old content. Removed members become no longer required rather than appearing indefinitely overdue. Editing acknowledged announcement content or changing the request's audience/reviewers invalidates old acknowledgements for the new revision and shows “Updated—please acknowledge again”; old response metadata remains bound to its old version and follows retention. Withdrawing/deleting/expiring the announcement closes the request and clears related local reminders, cached report data, and response content under the same retention policy. A pin cannot extend that lifetime.

Optional reminders are local, respect mute/quiet/OS settings, and default to at most one per day. No notification or background worker may acknowledge on the user's behalf. Admin reports must label pending/late as absence of a received explicit response, not proof of neglect or failure to read. Exporting identifiable response details is an explicit policy-controlled disclosure, disabled by default.

### 30.7 Community welcome and newcomer onboarding (FR-COM-03, P0)

After approved root enrollment, show a welcoming community overview with an authenticated, versioned encrypted **onboarding package**: community description/purpose, welcome text, current rules, optional rules-acknowledgement request, recommended subgroup references, contact/help entry, and a bounded checklist (maximum 20 items in P0). Community owner/admin editors use their authenticated metadata permissions. The package identifies its revision, editor, rules digest/version, and item IDs; a server-generated welcome page cannot silently replace trusted community rules.

Typical checklist items are “Read the community description”, “Acknowledge the rules”, “Choose discussion groups”, and “Set notification preferences”. Distinguish required guidance from optional suggestions, provide “Continue later”, and keep all controls keyboard/screen-reader accessible. Checklist progress is private E2EE own-device state, using stable item IDs and mutation counters. Community/platform admins cannot inspect personal checklist completion. Explicit rules acknowledgement is the only onboarding response shared with the named authorized reviewers, using the same scoped encrypted response/revision/retry contract as §30.6 and labeled separately from announcement acknowledgements.

Rules acknowledgement is optional per community, clearly names the rules version/reviewers, and is never inferred from scrolling or joining. A rules revision produces an “Updated rules—review and acknowledge” banner; completing the prior version cannot acknowledge the new one. Changing only welcome text or recommendations preserves unaffected checklist items; removed items/obsolete recommendations do not remain blocking tasks. Local progress survives restart and converges across Android/web. Lost browser storage follows normal re-link/recovery semantics; it does not manufacture previous acceptance.

Onboarding begins after membership approval and does not bypass SSO, root/subgroup consent, or authenticated Add/Welcome. Completion/rules acknowledgement is **not an access-control credential or legal acceptance mechanism**; it cannot grant subgroup keys, admin rights, or guarantee that already admitted users cannot read root content. Each recommended subgroup respects the existing discoverability/eligibility policy; private names/rosters are not disclosed through recommendations, and Join still follows that group's request/approval flow. Recommended groups never auto-enroll a user. Welcome/rules content is deliberately shared current metadata for new members, not automatic disclosure of old pinned messages or announcement history.

Store current package/rules as encrypted community metadata, not plaintext server content. Own-device checklist progress and reviewer-scoped rules responses follow the community's documented retention policy; obsolete rules-version response retention is bounded (default maximum 30 days), with no indefinite onboarding behavioral history. Expired/deleted packages clear obsolete progress/reminders; removing a user stops future package updates and group recommendations. Previously downloaded rules/content remain subject to the normal honest-client/endpoint limits.

**Acceptance evidence for both features:** first join and resume; disabled read receipts; two devices responding concurrently; offline duplicate/reordered delivery; due time versus expiry; edited/deleted announcement; changed rules and changed reviewer set; reviewer demotion; member removal/rejoin; private/ineligible recommended group; checklist item addition/removal; and browser storage loss. COM-01 defines schemas/roles/private response routing, COM-02 implements Android/web journeys and failure cases, UI-01 verifies accessibility, and SEC-01/02 reviews response confidentiality/metadata minimization. Neither feature adds an iOS prerequisite.


### 30.8 Everyday chat refinements (Android/web P0)

These requirements incorporate the selected recommendations **1, 4, 7, 8, 9, 17, 18, 22, 24, and 30** from the user-facing feature list. They apply to authorized content and preserve existing encryption, role, expiry, and browser-trust contracts. They are planned behavior, not shipped UI.

| Selected idea | Feature | Main implementation tasks |
|---|---|---|
| 1 | Rich group/community descriptions | GRP-01/03, COM-01/02, FEAT-03 |
| 4 | Per-chat themes and wallpapers | FEAT-03, UI-01 |
| 7 | Searchable member lists/admin filters | GRP-03, COM-02, FEAT-03 |
| 8 | Groups in common | FEAT-03 |
| 9 | Photo albums | FND-01, FEAT-01 |
| 17 | Mentions-only notifications | FEAT-02, AND-02/WEB-02 |
| 18 | Unread catch-up navigation | FEAT-03 |
| 22 | Multiple-message selection and actions | FEAT-02/03 |
| 24 | Fast message actions | FEAT-03, UI-01 |
| 30 | Conversation snoozing | FEAT-02, AND-02/WEB-02 |

**Rich descriptions.** Group/community About pages support purpose, paragraphs/lists, safe basic emphasis, approved contact references and explicit links, with a serialized-description budget of 8 KiB. Use a typed safe rich-text representation and plain-text fallback; never render arbitrary HTML, JavaScript, CSS, or automatically fetched embeds. Names/contact details come from authorized local profiles or handles; link destinations are visible before opening and link previews remain off by default. Metadata edits require the existing authenticated editor role/version, update consistently across devices, and do not silently change separately versioned community rules/acknowledgements. Keep descriptions and any rich metadata encrypted; unauthorized directory/pre-join previews do not receive them unless the existing visibility/consent policy explicitly permits that disclosure.

**Private themes and wallpapers.** Users choose a conversation color/background independently of other members. Store selections in encrypted local preferences and sync only to own devices; a personal theme never changes the group's shared identity. Offer bundled offline assets and optional user-selected raster images through the existing encrypted-media path. No third-party wallpaper/CDN calls or executable image content. Validate decoder/size limits, strip metadata by default, keep text/focus/delivery indicators readable in light/dark/high-contrast modes, provide Reset, and exclude custom backgrounds from lock-screen previews. Expiring message media cannot be retained as wallpaper to bypass its policy.

**Member search and groups in common.** Search the current authorized account-level roster by locally decrypted display name/available handle; provide All and Admins filters (owners included and labeled). Devices are not duplicate people. Apply Romanian diacritic/case handling and accessible counts/focus; changing scopes, removal, or loss of membership clears stale results. A contact's Groups in common view is a local intersection of the viewer's current authorized group memberships and those groups' rosters. Include active groups where both accounts belong; exclude left/deleted/inactive groups and do not enumerate private groups, community links, or target memberships the viewer cannot access. Privately archiving an otherwise active conversation does not change membership or by itself remove it from this intersection. The UI does not upload the contact's social graph/search terms to a new directory endpoint. If current state cannot be established offline, label last-known/stale results or defer, rather than presenting an authoritative empty/current list.

**Photo albums.** Send 2–10 photos as one ordered logical message, with optional album and per-photo captions and stable photo IDs/order in the encrypted schema. Combined captions/text and encoded metadata obey the existing message/envelope limits in §26.3. One photo uses ordinary media presentation; mixed files remain ordinary attachments in P0. Each photo uses independent reviewed attachment encryption; array order/captions are authenticated inside the message. Publish the album only after every retained photo upload succeeds; resume stored ciphertext after interruption or let the user explicitly remove failed selections before sending. Retries cannot duplicate the album or reorder pictures. Present a grid and full-screen next/previous viewer with accessible photo count/captions; a missing/expired photo keeps its unavailable slot. Apply the message's expiry to all pointers/keys/caches/captions. Albums are one message for batch selection, receipts, editing/deletion policy and notification grouping; no server image composition or plaintext transcoding.

**Mentions-only notifications.** Each group/community conversation offers All messages, Mentions only, and Muted modes. The client decrypts and validates structured mentions of the user's account before creating a mentions-only alert; raw text resembling a handle or an untrusted public type hint is insufficient. Every message still follows normal delivery/unread state, and generic provider wake-ups reveal no mention list. If a locked/suspended client cannot safely decrypt, defer the visible mention alert until permitted processing instead of alerting on every message. Explain this behavior in notification settings. Ordinary announcement/rules reminders respect this mode; explicit call/security notices retain their separate documented controls. Mode preferences sync E2EE to own devices; each device's OS permissions can further restrict notifications.

**Unread catch-up.** On opening a conversation, capture a stable first-unread boundary from the account's encrypted read state, offer Jump to first unread and Jump to latest, and retain a device-local message anchor/offset for Return to previous position. New arrivals while reading older messages do not pull the viewport to the bottom. Windowed pagination, restart, rotation and browser reload restore an available anchor without loading the full history. Expired/deleted/missing anchors fall back to the nearest retained content with an explanation; never resurrect content. Opening a list, jumping, or restoring scroll does not itself fabricate read receipts or acknowledgement responses. Advance read state only according to the existing visible-content/read policy; local navigation state is not published to peers.

**Multiple-message selection.** Select up to 100 messages within one conversation, including across loaded history pages, and show Copy, Forward, Save/bookmark, Delete locally, and eligible Delete for everyone/moderation actions with clear counts. P0 forwarding has one explicit destination per confirmation; target posting/role restrictions and rate limits still apply. An album selects as one message; media-specific actions remain available in its viewer. Revalidate each item for current author/role authority, expiry, export policy and availability at execution. Mixed-author selections never grant blanket delete/edit rights. Explain unavailable items and require confirmation before an eligible-subset destructive action; report accepted/pending/failed/skipped item counts. Batch operations are independent idempotent per-message operations, not an atomic cross-message promise. Retries resume failed/pending items without re-forwarding accepted ones. Copy/share is an explicit plaintext disclosure to the chosen clipboard/app/destination; private bookmarks remain references and cannot extend expiry.

**Fast accessible actions.** Android supports swipe-to-reply and long-press selection/context actions; web exposes action controls on hover **and** keyboard focus, context menus, and documented shortcuts. Every gesture/shortcut has an equivalent visible labeled control, with no requirement for precise gestures or a mouse. Preserve text selection and distinguish scrolling from swiping; do not trigger reply/delete while dragging. Respect reduced motion, target sizing, TalkBack/screen readers, modal focus return and Escape/cancel. Shortcuts do not send/delete during IME composition, in unrelated text fields, or while a dialog owns focus; destructive actions still require policy/confirmation. Re-check authorization when an action executes, not only when its menu opens.

**Timed conversation snoozing.** Temporarily suppress ordinary alerts until This evening (18:00 if still upcoming, otherwise 18:00 next day), Tomorrow morning (09:00 next local day), a duration, or a custom future date/time. Show the exact resolved time/time zone before confirmation and store the resulting UTC deadline plus chosen zone. Snooze is an overlay on the existing All/Mentions only/Muted mode; expiry restores that underlying mode, never forces All messages. A deliberate mode edit while snoozed changes the underlying mode and the UI states what will resume. E2EE sync carries deadline/mutation version to own devices; stale sync cannot re-enable an expired snooze. Messages still arrive/count unread; calls/security controls remain separate. Evaluate expiry on startup/resume, new delivery, and background execution where available—no exact OS alarm or closed-browser wake guarantee. Once a snooze expires, persist that outcome so a clock rollback or old sync event cannot reactivate the same snooze; a new snooze requires a new user mutation. Allow End snooze now; do not issue a backlog notification flood when it ends or silently change the deadline after a time-zone/DST change.

**Acceptance:** Android↔web preference sync; long/RTL/hostile rich descriptions; removed members and inaccessible groups in common; offline/stale rosters; custom-wallpaper contrast; partial album uploads/reordered retries and photo expiry; spoofed mentions with locked apps; new arrivals during catch-up; expired saved anchors; mixed-author batches with role changes and partial failures; keyboard-only/TalkBack/IME actions; snooze expiry across restart, offline devices, explicit Muted mode, daylight-saving changes and clock correction. Record feature/schema evidence in FND-01, FEAT-01/02/03, GRP-03, COM-02 and REL-01. iOS remains later scope.
