# Convo security

This document describes **what Convo actually does today** to protect messages, accounts and the
deployment, how each mechanism is configured and tested, and where the current implementation is
weaker than the target design. It is kept in step with the code: every change to a security
mechanism updates the matching section here (see §20).

Design-level requirements and the full threat model are in [specs.md](specs.md) and
[arf.md §4](arf.md); interim choices are recorded in [decisions](decisions).

> **Status.** Convo is pre-release. Several components are deliberate interim stand-ins that must
> be replaced or independently reviewed before general availability — most importantly the
> TypeScript Signal and MLS libraries (ADR-0001), the Android storage model (§8.3) and the
> absence of post-quantum keys. They are called out where they matter.

Diagrams (sources in [diagrams/security](diagrams/security)):

| | |
|---|---|
| Architecture and trust boundaries | [architecture.svg](diagrams/security/architecture.svg) |
| Sending a 1:1 message (Signal) | [message-flow.svg](diagrams/security/message-flow.svg) |
| Calls (LiveKit SFU + coturn) | [calls.svg](diagrams/security/calls.svg) |
| Network exposure and firewall | [network.svg](diagrams/security/network.svg) |

---

## 1. Summary: who can see what

| Party | Can see | Cannot see |
|---|---|---|
| Convo server, database, object storage | accounts, device public keys, who sends to which **account/device** and when, group membership, envelope sizes (padded), attachment ciphertext sizes (bucketed), push endpoints, IP addresses at the edge | message text, attachments, reactions, receipts, typing, group names/descriptions, profile names/photos, call audio/video, contact lists |
| Keycloak (identity provider) | usernames, names, email, phone, credentials (password hash, passkey public keys, OTP seeds), sign-in events | anything Convo encrypts; it never receives message or history keys |
| LiveKit SFU / coturn | who is in a call room, when, packet sizes and timing | call audio/video (frames are end-to-end encrypted) |
| Push service (ntfy) | that *some* device should wake up, and whether it is urgent (a call ring) | sender, conversation, content |
| Browser push service (Web Push, opt-in: Google FCM, Mozilla, Apple, Microsoft) | that this browser should wake up, when, and whether it is urgent | sender, conversation, content, account name (the request is empty) |
| Administrators | directory data, devices, aggregate statistics, per-person activity *counts*, audit log | any message content or keys — no such API exists |
| Someone holding an **unlocked** phone or browser | everything the user can see | — (end-to-end encryption does not protect an unlocked endpoint) |

---

## 2. Cryptography inventory

| Purpose | Construction | Implementation | Where |
|---|---|---|---|
| 1:1 messages and multi-device fan-out | Signal: X3DH key agreement + Double Ratchet, Curve25519/XEdDSA identity keys, AES-256-CBC + HMAC-SHA256 message keys | `@privacyresearch/libsignal-protocol-typescript` (interim, ADR-0001) | `apps/web/src/crypto/signal*.ts` |
| Groups, channels, community announcements | MLS (RFC 9420), suite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` | `ts-mls` with a portable pure-JS provider (interim) | `apps/web/src/crypto/mls.ts` |
| Content padding | append `0x80`, zero-pad to a size bucket (hides exact length) | Convo | `crypto/padding.ts` |
| Attachments | per-file random 256-bit key; STREAM chunked AES-256-GCM (64 KiB chunks, nonce = prefix ‖ counter ‖ last-flag, header as AAD), size-bucket padding, SHA-256 digest checked before decryption | WebCrypto | `crypto/attachmentCipher.ts` |
| Device request authentication | ECDSA P-256 / SHA-256 over method, path, body digest, request ID, expiry and a single-use server nonce (`ENCLAVE-REQ-V2`) | WebCrypto (non-extractable key), Java verifier | `api/http.ts`, `identity/internal/auth` |
| Device linking channel | X25519 ephemeral ECDH → HKDF-SHA256 (salt = SHA-256(transcript)) → AES-256-GCM with the transcript as AAD; 12-digit comparison code / QR | WebCrypto | `crypto/provisioning.ts` |
| Local storage (web and Android WebView) | AES-256-GCM per record (fresh 96-bit IV), HMAC-SHA256 pseudonyms for keys/conversation IDs; optional passphrase: Argon2id (64 MiB, t = 3) wraps the keys | WebCrypto + `hash-wasm` | `storage/encryptedStore.ts` |
| History archive | HKDF-SHA256 (`CONVO-VAULT-V1`) from the account identity secret → AES-256-GCM entries bound to version/deployment/account | WebCrypto | `crypto/accountVault.ts` |
| Recovery kit | random 256-bit code → HKDF → separate wrapping key and authorization key; server stores the wrapped identity and SHA-256(authorization key) | WebCrypto | ADR-0004 |
| Call media | per-call random 256-bit key shared only inside the E2EE ring; LiveKit frame encryption (AES-GCM, insertable streams / frame cryptors); rotated when someone leaves a group call | `livekit-client` / `livekit-android` E2EE | ADR-0006, `ui/calls` |
| Safety numbers | SHA-512 iterated 5200× over identity keys (libsignal-compatible fingerprints) | Convo | `crypto/safetyNumber.ts` |
| Transport | TLS 1.2/1.3 (nginx / ingress / Cloudflare); WebSocket over TLS | nginx, ingress-nginx | §16 |
| Audit chain | SHA-256 hash chain over admin actions + checkpoints in an independent append-only file | server | `admin/internal/AuditLog` |

No custom ciphers are used; constructions follow the Signal, MLS, WebCrypto and HKDF
specifications. Post-quantum protection (PQXDH/Kyber, PQ MLS) is **not** implemented yet: the
interim libraries lack it (tasks FND-02, PQ-01).

---

## 3. Identity and sign-in

* Convo has its **own** Keycloak realm (`enclave`) served on the app origin under `/auth`
  (Compose `keycloak`; Kubernetes `app-charts/convo/keycloak`). Accounts are created in Convo on
  first sign-in from the token's `(issuer, subject)`.
* Clients use the OIDC authorization-code flow with **PKCE (S256)**: `enclave-web` (browser),
  `convo-android` (redirect `com.convo.android:/oauth2redirect`, AppAuth in a Custom Tab),
  `convo-admin` (admin console, separate origin). Redirect URIs are exact, never wildcards.
* Sign-in options: password, **passkey** (passwordless, §4), optional authenticator app (TOTP);
  the realm can require a profile (phone) at first sign-in.
* An organization token alone cannot use the API: every request also needs the device signature
  (§5.2).
* Token and session lifetimes are Keycloak's; Convo keeps the token in memory/encrypted storage and
  re-authenticates when it expires.

## 4. Passwordless (passkeys)

### What a passkey is used for

| Use | What the passkey proves | What it does **not** do |
|---|---|---|
| Sign in to the organization (Keycloak) without a password | possession of the authenticator + user verification (fingerprint, face, screen lock) | it does not hold or unlock message keys |
| Gate for app lock and per-chat locks | the account has a confirmed passkey, so the user can re-verify on demand | it is not the encryption key of the local store (§11) |

A passkey is **not** a replacement for the recovery kit (§10): it proves *who you are* to the
sign-in service but gives no key material, so after losing every device a passkey gets you signed
in, while only the recovery code can decrypt the uploaded history. WebAuthn PRF (deriving a secret
from a passkey) is the planned way to bind keys to passkeys (§19).

### How it is configured

| Setting | Value | Where |
|---|---|---|
| Passwordless WebAuthn RP ID | the deployment hostname (`convo.doncik.ro`) | realm JSON; re-applied from `CONVO_HOSTNAME` by the setup job on every run |
| User verification | `required` | realm JSON |
| Resident key (discoverable credential) | `Yes` | realm JSON |
| Required actions | `webauthn-register-passwordless`, `delete_credential`, `UPDATE_PROFILE`, `UPDATE_PASSWORD`, `CONFIGURE_TOTP`, `webauthn-register`, `VERIFY_PROFILE`, … registered **and enabled** | realm JSON `requiredActions` + setup job |
| `enclave-web` redirect URIs | exactly `/convo/callback`, `/convo/passkey-done` (no wildcards), PKCE S256 | realm JSON + setup job |
| Account console | hidden on the public origin (`CONVO_KEYCLOAK_ACCOUNT=off`) | web image / chart values |
| Admin console, master realm | hidden on the public origin (`CONVO_KEYCLOAK_ADMIN=off`) | web image / chart values |

The setup job (`deploy/keycloak/credential-status-client.sh`, Compose `keycloak-setup`, Kubernetes
post-sync Job) is idempotent: it keeps the RP ID equal to the hostname, registers any missing
required action, provisions the read-only `convo-credential-status` service account
(`realm-management/view-users` only), the admin console clients (§13) and the admin roles.

> **Lesson learned (2026-10-21).** A realm *import* registers only the required actions its JSON
> lists. Production was imported from a JSON that listed only `VERIFY_PROFILE`, so Keycloak answered
> "Turn on passwordless sign-in" with `kc_action_status=error` while the result page unconditionally
> said "Your passkey is ready". Both are fixed, and `identity-config.spec.ts` plus the production
> smoke test now catch this class of error.

### Flows

1. **Turn on / add a passkey.** Settings → Privacy → Passkeys opens Keycloak's
   application-initiated action `kc_action=webauthn-register-passwordless` (web: new tab; Android:
   Custom Tab) for `enclave-web` with a throwaway PKCE challenge. The browser talks to the
   authenticator; Keycloak stores the public key and redirects to `/auth/convo/passkey-done` with
   `kc_action_status=success|cancelled|error`, which the page shows truthfully (`state` prefix
   `add.`/`remove.` tells it which action ran).
2. **List.** `GET /v1/account/credentials` (device-signed) returns the account's own passkeys (ID,
   name, date) via the read-only service account; `?refresh=true` bypasses the server cache.
3. **Remove.** Keycloak's `kc_action=delete_credential:<id>` with its own confirmation page.
4. **Sign in with a passkey.** Keycloak's "Sign in with Passkey" or conditional UI; the apps keep
   using OIDC code + PKCE.
5. **Locks** can only be turned **on** after the IdP confirms a passkey (§11). A status outage
   never silently turns locks off.

Passkey names must be unique per account (Keycloak refuses duplicates; nothing changes).

---

## 5. Devices

### 5.1 Enrollment

A device (browser profile or Android install) generates, locally: a Signal identity key pair
(shared by the account's devices, see §7), its own Signal registration ID, signed prekey and
one-time prekeys, MLS KeyPackages, and an **ECDSA P-256 request-signing key** (non-extractable
WebCrypto key). The first device registers with a signed enrollment transcript bound to the
server's single-use reservation challenge; device IDs are never reused.

### 5.2 Every request is signed

After sign-in, each API call carries the OIDC token **and** `X-Enclave-Signature` over the
canonical request (method, path with query, SHA-256 of the body, request ID, expiry and a
single-use server nonce, profile `ENCLAVE-REQ-V2`). The server rejects replays (request-ID cache,
nonces consumed atomically), expired requests, revoked or disabled devices and accounts. A stolen
token cannot be used without the device key, and a stolen device key cannot be used once the
device is revoked. Shared Java/TypeScript test vectors (`contracts/vectors`) keep both sides
identical. WebSocket connections use one-time, origin-bound tickets obtained with a signed request.

### 5.3 Revocation

A user unlinks a device in Settings → Devices; an administrator can revoke one; a recovery revokes
lost devices. Revocation deletes the device's mailbox, closes its sockets, stops all future
fan-out to it, removes it from MLS groups (the remaining members commit the removal) and notifies
the account's other devices (persistent security notice in Note to self). An honest client wipes
its local data on its next contact. Offline copies on a stolen device cannot be erased remotely
(see §18).

---

## 6. Sending and receiving messages

### 6.1 1:1 conversations (Signal)

1. The sender fetches the recipient account's **device roster** and claims one prekey bundle per
   device it has no session with (identity key, signed prekey, one one-time prekey — claimed
   atomically, never reused).
2. **X3DH** establishes a session per recipient device; the **Double Ratchet** derives a fresh
   message key for every message (forward secrecy and post-compromise recovery).
3. The message (text, reply, reaction, edit, receipt, typing, call signalling…) is serialized to a
   typed content structure, **padded** to a size bucket and encrypted separately for **every
   device** of the recipient **and every other device of the sender** (own-device sync).
4. The client submits all device ciphertexts in one idempotent request (`submissionId`; the same
   stored ciphertext is retried after a lost response). The server checks the roster version: if a
   device was added or removed it answers `DEVICE_MISMATCH`/`STALE_DEVICES` and the client
   re-encrypts for the current roster — nobody is silently left out or added.
5. The server stores one **ciphertext envelope per device** in PostgreSQL and signals the device
   (WebSocket hint, or a content-free push wake, §12).
6. The recipient device drains its mailbox, decrypts, and in **one local transaction** stores the
   plaintext, the advanced ratchet state and a "processed" marker; only then does it acknowledge,
   and the server deletes the envelope. Unacknowledged envelopes expire after 30 days.
7. Identity-key changes are shown and, once a contact is verified with safety numbers, sending is
   blocked until the user accepts the new key.

Sealed sender (hiding the sender from the server) is not implemented yet (PRIV-01): the server
sees which device sent each envelope.

### 6.2 Groups, channels and communities (MLS)

Groups use **MLS** (RFC 9420). Each device is an MLS leaf; membership changes are **commits**
ordered by the server's delivery service (epoch compare-and-set, idempotent, ordered catch-up).
Application messages are encrypted once to the group epoch and fanned out by the server to every
member device. The server keeps an **ACL mirror** (who is a member, owner/admin role) to route and
to refuse writes from non-members and member posts in admin-only channels; it never holds group
keys. Group names, descriptions, pins, timers and community metadata are encrypted application
messages; receivers accept metadata changes only from owners/admins (re-checked against the group
state). Removing a member or a member leaving triggers an MLS removal: they cannot read later
messages. Invite links are hashed bearer tokens with expiry; join requests need admin approval;
bans are enforced server-side.

Known gaps (GRP-01): MLS credentials are not yet cryptographically bound to the account identity
key, and the role profile has not been independently reviewed.

### 6.3 Attachments

The sender encrypts the file locally (STREAM AES-256-GCM, per-file random key, padding), uploads
the ciphertext with a presigned URL (resumable multipart above 8 MiB), and sends the **key, digest
and object ID inside the encrypted message**. The object store sees only padded ciphertext;
recipients verify the digest before decrypting. Images are re-encoded to strip EXIF/location;
encrypted ≤ 32 px thumbnails travel inside the message. Objects expire with retention.

---

## 7. New devices, linking and multi-device

* **Linking:** a new device signs in (Keycloak) and shows a 12-digit code (and QR). A trusted device
  compares and approves; the account identity and current state travel over the **X25519 → HKDF →
  AES-GCM provisioning channel** bound to both devices' transcript. The server relays only
  ciphertext and requires both the new device's token and the approving device's code.
* **What transfers:** the account identity secret (so the new device can decrypt the history
  archive) and current preferences — **not** Signal ratchet state or MLS leaf secrets. Each device
  has its own sessions; groups add the new device through a normal MLS commit.
* **Receiving on another device:** every sender encrypts for every device of the recipient account
  (§6.1), so all linked devices receive new messages independently. Messages a device sends are
  synced to the account's other devices as encrypted transcripts.
* **Earlier history** on a new device comes from the encrypted **history archive** (§9), not from
  the server's mailbox (which only holds undelivered ciphertext).

---

## 8. Storage

### 8.1 Server (PostgreSQL, S3, Valkey)

| Data | Stored as | Retention |
|---|---|---|
| Mailbox envelopes | ciphertext per device + routing metadata | deleted on acknowledgement; ≤ 30 days |
| History archive | AES-GCM entries under the account archive key | until deleted with the account |
| Recovery registration | wrapped account identity + SHA-256 of the authorization key | until replaced or revoked by an admin |
| Attachments (S3) | padded ciphertext objects | retention policy |
| Prekeys, KeyPackages | public keys | until claimed/replaced |
| Group ACL mirror | group IDs, member accounts, roles (no names) | group lifetime |
| Calls | call IDs, room, creator, peer/group, times (no media) | operational |
| Push | endpoint per device, wake intents (no content), dead letters 24 h | §12 |
| Activity statistics | encrypted items sent per account per day (counts only) | 90 days, can be turned off |
| Audit log | admin actions, reasons, hash chain | 365 days policy |

Valkey holds only ephemeral hints (presence, wake-up channels). Database and object-store
encryption at rest is a deployment responsibility (disk encryption on the node).

### 8.2 Browser (web client)

`EncryptedStore` (IndexedDB): every record and message is AES-256-GCM sealed with a fresh IV;
conversation and key names are HMAC pseudonyms. The seal key is a **non-extractable WebCrypto key**:
page scripts cannot export it, but it is persisted by the browser in the profile directory, so
someone who copies the profile can decrypt the store. Enabling the **browser passphrase**
(Settings → Privacy) wraps the keys with **Argon2id** (64 MiB, 3 passes): without the passphrase a
copied profile is ciphertext only, and the app locks by reloading (keys dropped from memory) after
inactivity. Tabs coordinate with a leader lock; sign-out destroys the database.

### 8.3 Android

The Android client runs the same encryption core in a headless WebView, so its store is the same
`EncryptedStore`, in app-private storage (`/data/data/com.convo.android/app_webview`).
`allowBackup=false` and `fullBackupContent=false` exclude it from Android/Google backups; cleartext
traffic is disabled; screens use `FLAG_SECURE` (no screenshots or app-switcher previews); preview
files are deleted at start; notifications are generic.

**Weakness (to be fixed, §18):** the store keys are not wrapped by the Android Keystore and the
app/chat lock is not cryptographically bound to them. On a rooted or forensically imaged device,
the keys can be read from app storage and the database decrypted — the attack class shown in the
paper analysed in §18.

---

## 9. History archive

Each device journals message and conversation changes **in the same local transaction** as the
change and uploads them as AES-256-GCM entries under the **archive key** (HKDF from the account
identity secret, domain-separated, bound to version/deployment/account). The server stores opaque
ciphertext with an account sequence. A linked or recovered device downloads and decrypts the
archive. Locally deleted messages leave encrypted suppression markers so delayed archive entries
cannot resurrect them; expired disappearing messages are never restored. The archive is
append-only ciphertext: deleting a message removes it from devices, not from earlier archive
entries (they are unreadable without the account key).

## 10. Recovery kit

* Created on a device (Settings → History and recovery): a random **256-bit code**, shown once, to
  be stored offline.
* The code derives two independent keys (HKDF): a **wrapping key**, which encrypts the account
  identity secret, and an **authorization key**. The server stores the wrapped identity and
  SHA-256(authorization key) — never the code.
* After losing every device: sign in with Keycloak **and** prove the authorization key; the server
  returns the wrapped identity, the new device unwraps it locally, restores the archive, and lost
  devices are revoked. A password reset alone can never decrypt history; neither Keycloak nor the
  server ever holds the code or the archive key.
* The last device cannot log out without a configured recovery kit (it would lose the account).
* **Lost or leaked kit:** an administrator with `RECOVERY_RESET` revokes it in the admin console
  (reason audited, recent sign-in required): the server deletes the registration, the old code stops
  working immediately, devices keep working, and Settings shows "no recovery code" so the person
  creates a new one. Administrators cannot read or recreate a kit.

---

## 11. Locks

| Lock | Protects against | Cryptographic? |
|---|---|---|
| **Browser passphrase** (web) | a copied/stolen browser profile; someone opening the browser later | **Yes** — Argon2id-wrapped store keys, dropped from memory on lock |
| **App lock** (web) — passkey on open / after inactivity | casual access to an open, logged-in browser | No — UI gate (WebAuthn user verification); keys stay available to the page |
| **App lock** (Android) — fingerprint/face/screen lock | casual access to an unlocked phone | No — BiometricPrompt UI gate |
| **Chat lock** (web/Android) | a locked chat being shown, searched, saved or forwarded without re-verification | No — UI gate; the chat's messages are in the same store |

Locks require a confirmed passkey to be turned on. Making app and chat locks cryptographic is the
main recommendation of §18.

## 12. Push notifications

Offline Android devices receive **content-free** UnifiedPush wakes through the organization's
**ntfy**: the payload is a constant (`{"t":"wake"}` or `{"t":"urgent"}` for a call ring). The device
connects and fetches ciphertext. Endpoints must be on allow-listed origins (no SSRF), are never
logged, and are deleted on revocation. Wake intents are committed with the envelopes, delivered by
leased workers with retries, and failures kept 24 h as sanitized dead letters (MSG-02). Generic
notification text is the default; locked chats and app lock force it.

**Web Push (browsers, opt-in in Settings → Notifications):** a closed tab is woken through the
browser vendor's push service. The server sends an **empty** request (no payload, so no RFC 8291
message encryption is needed and none can leak) signed with the deployment's VAPID key (ES256,
RFC 8292; JWT cached per push service for 12 h); only `TTL` and `Urgency` reveal "urgent or not".
Accepted endpoints are HTTPS on the default port at allow-listed push-service hosts
(`enclave.push.web-push.hosts`). The service worker (`/sw.js`, no caching or fetch handling)
always shows the same "New message or call" text. Because the vendor learns *when* this browser
receives mail, Web Push is off until the user enables it; the VAPID private key is a deployment
secret (`deploy/vapid-keys.sh`).

## 13. Calls

* **Signalling** (ring, accept, decline, cancel, end) travels as E2EE messages over Signal/MLS.
* The caller generates a **random 256-bit call key** and sends it only inside the encrypted ring.
* Media flows through the self-hosted **LiveKit** SFU (WebRTC, DTLS-SRTP) with **frame encryption**
  (insertable streams / frame cryptors) under the call key — the SFU forwards ciphertext frames.
  Clients that cannot encrypt frames are refused; there is no unencrypted fallback, and the UI shows
  "End-to-end encrypted" only after LiveKit reports every remote participant's frames as encrypted.
* The server's `calls` module authorizes rooms and issues **10-minute LiveKit join tokens per
  device**, re-checking group membership for each join. Removing someone from a group kicks them
  from open rooms; the remaining participants **rotate the call key** through the MLS group they
  were removed from.
* **coturn** relays media for clients behind restrictive NATs (long-term credentials, relay into
  cluster/Docker networks denied). Relayed media is still frame-encrypted.
* Limits: one shared key per call (no per-participant forward secrecy within a call); the SFU sees
  who is in a room and traffic patterns.

## 14. Disappearing messages and deletion

Per-chat timers (24 h / 7 d / 90 d) are encrypted events; receivers enforce them using server
timestamps. Expired messages are removed from the local store, search, previews and media caches by
a sweeper; suppression markers stop late archive replays. Delete-for-everyone is an authenticated
request honoured by honest clients; it cannot erase copies on a modified client or screenshots.
Storage engines may keep deleted bytes until compaction (see §18).

## 15. Administration

The admin console runs on its **own origin** (`convo-admin.doncik.ro`, Compose `:9443`), so the
messenger origin serves no admin code (`/admin` → 404). Its nginx exposes only the console,
`/v1/admin/*` and the realm sign-in pages.

* Sign-in with the `convo-admin` client (PKCE); tokens only in the tab's sessionStorage.
* Scoped roles enforced by the server on **every** call: `convo-admin` (all), `convo-security`,
  `convo-org-admin`, `convo-helpdesk`, `convo-auditor`; the permission matrix is in
  `AdminPermissions` and drawn in the console (Roles & permissions).
* Every change requires a **reason** and is appended to the **hash-chained audit log** together with
  the action; refused attempts are audited too; admin sessions are recorded. Credential, sign-in and
  role changes need a **recent sign-in** (step-up, 10 min); nobody can change their own credentials
  or roles.
* Sign-in accounts are managed through `convo-admin-ops`, a confidential Keycloak client limited to
  `manage-users`, `view-users`, `view-realm` (no realm administration). Temporary passwords are
  generated server-side, shown once, never logged, and must be changed at next sign-in.
* Chain heads are checkpointed to an independent append-only file; verification compares the
  database with every checkpoint; exports are recorded before they are produced.
* Statistics are counts only (encrypted items per account per day — the server cannot tell messages
  from receipts), kept 90 days and switchable off (`enclave.admin.activity.enabled`).

---

## 16. Network exposure, ports and firewall

### 16.1 Kubernetes (homelab, production)

No inbound HTTP ports are opened on the router: HTTPS reaches the cluster through an **outbound
Cloudflare tunnel** (`cloudflared`) to ingress-nginx. Only call media needs inbound ports.

| Port | Protocol | Service | Exposure | Why |
|---|---|---|---|---|
| — | HTTPS (443 at Cloudflare) | `convo.doncik.ro`, `convo-admin.doncik.ro` | public via Cloudflare tunnel (outbound from the cluster) | app, API, WebSockets, `/auth`, `/rtc` signalling, admin console |
| 50000–50100 | UDP | LiveKit media | router → node | call audio/video (WebRTC) |
| 7881 | TCP | LiveKit ICE/TCP | router → node | calls when UDP is blocked |
| 3478 | UDP + TCP | coturn | router → node (DNS-only `turn.doncik.ro`) | TURN relay negotiation |
| 49160–49200 | UDP | coturn relay | router → node | relayed media |
| 443 / 80 | TCP | ingress-nginx | **LAN only** | `*.homelab.ro` internal hosts |
| 6443, 22 | TCP | Kubernetes API, SSH | **LAN only / never forwarded** | administration |

Everything else — PostgreSQL 5432, Redis 6379, MinIO 9000, Keycloak 8080/9000, the Convo server
8080, LiveKit 7880 (signalling is proxied by convo-web), ntfy 80 — is **cluster-internal only**
(ClusterIP Services); LiveKit and coturn use host networking only for their media ports.

### 16.2 Docker Compose (development / single host)

| Host port | Service | Bind | Note |
|---|---|---|---|
| 443, 8443 | web (HTTPS) | all interfaces | messenger |
| 8088 | web (HTTP) | all | only an "HTTPS required" page |
| 9443 | admin console | all | restrict to admins' network in production |
| 3478 udp/tcp, 49160–49200 udp | coturn | all | calls |
| 7881 tcp, 50000–50100 udp | LiveKit | all | calls |
| 8091 | ntfy | all | Android push distributor |
| 5050 | pgAdmin | **127.0.0.1** | development only |
| 5433 | PostgreSQL | **127.0.0.1** | development only |

### 16.3 Firewall recommendations

* Inbound: allow only the call-media ports above to the node running LiveKit/coturn; deny all other
  inbound traffic from the internet. Keep SSH and the Kubernetes API on the LAN/VPN only.
* coturn denies relaying to the cluster networks (`10.42.0.0/16`, `10.43.0.0/16`) and Docker
  networks (`172.16.0.0/12`) so it cannot be used to reach internal services; keep that list in step
  with the cluster CIDRs.
* Outbound: the cluster needs Cloudflare (tunnel), Docker Hub (images), and the STUN target LiveKit
  uses to discover its public address. No other egress is required by Convo.
* Consider restricting `convo-admin.doncik.ro` with Cloudflare Access (an additional identity check
  in front of the console) or serving it on the LAN only.
* Cloudflare terminates TLS for public hosts: it can see HTTP traffic in transit, which for Convo is
  end-to-end-encrypted payloads plus metadata and sign-in pages. Organizations that do not accept
  this should expose the ingress directly with their own certificates.

### 16.4 HTTP hardening

Strict CSP (`default-src 'self'`; no `unsafe-eval`; `wasm-unsafe-eval` only for WebAssembly
crypto; `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy:
no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, restrictive `Permissions-Policy`;
`Cache-Control: no-store` on API responses; bundled assets only (no CDNs, fonts or analytics).
Keycloak's admin/account consoles, the master realm and `/actuator` return 404 on public origins.
Plain HTTP serves only an explanation page.

## 17. Secrets, logging and metadata

* Secrets exist only in the cluster (`app-charts/convo/utils/create-secrets.sh` generates them) or
  in the ignored `.env`; never in Git, images or the APK. The debug APK pins only the public
  development certificate.
* The server never logs message payloads, keys, tokens, push endpoints or temporary passwords;
  IdP errors are logged by type only. Clients do not send telemetry.
* Day granularity is used for device last-seen and activity counters (metadata minimization).

---

## 18. Forensic resistance: analysis against *Son et al., "Forensic analysis of instant messengers: Decrypt Signal, Wickr, and Threema"* (FSI: Digital Investigation 40, 2022)

### 18.1 What the paper does

The authors decrypt **all** local data (databases, media, logs, preferences) of Signal, Wickr and
Threema on Android, assuming access to the phone and its screen-lock PIN:

* **Acquisition:** app-private storage is obtained through the messenger's own **backup/migration**
  feature (restored onto a rooted device), or directly on a rooted device.
* **Signal:** the SQLCipher key is wrapped by an **Android Keystore** key; a purpose-built app on the
  rooted device asks the Keystore to unwrap it (keys are non-extractable but still *usable*).
  Media keys derive from that key; logs are encrypted with keys stored the same way. The app lock is
  not part of the key derivation.
* **Wickr:** the default "automatic login" derives the database key from device identifiers
  (`android_id`) and files in app storage — no user secret; files stay usable after switching to
  password login.
* **Threema:** without a passphrase the key is XOR-ed with a hard-coded obfuscation key (trivial);
  **with** the messenger passphrase the key is wrapped by PBKDF2(passphrase) and the authors could
  **not** decrypt it without the passphrase.
* Weak KDF parameters (SQLCipher `kdf_iter = 1`) do not matter when the key itself is recovered.

**Lesson:** at-rest encryption only resists forensics if the key depends on a **user secret or
user-verified hardware key** that the examiner does not have; device-derived or OS-unwrappable keys
fall to anyone who controls the unlocked device or its storage. Cached files, thumbnails and logs
must be covered too.

### 18.2 Convo today

| Attack vector from the paper | Convo now | Result |
|---|---|---|
| Backup / migration export to a rooted device | Android backups disabled; history migrates only through the **E2EE archive** to a newly **linked** device approved on a trusted device (or with the recovery kit) | Not usable without the account, a trusted device or the recovery kit |
| Key unwrapped from local storage | **Android:** store keys sit in WebView IndexedDB in app storage (no Keystore, no user secret) — **like Wickr's automatic login**. **Web:** same without a passphrase; with the **browser passphrase** keys are Argon2id-wrapped — **like Threema with a passphrase** | Android and unprotected browsers: **decryptable by a forensic examiner**; passphrase-locked browsers: resistant (offline guessing cost Argon2id 64 MiB) |
| App lock bypass | App and chat locks are UI gates (like Signal's) | Not a cryptographic barrier |
| Media files | Attachments stay **encrypted in the store**; plaintext exists only in memory while viewed; preview temp files deleted at start | Bound to the store key — same result as the store |
| Logs | No plaintext message logging; no log files with content | Nothing to recover |
| Server seizure | Server holds ciphertext, wrapped keys and metadata only | No message content |
| Disappearing/deleted messages | Removed from the store; IndexedDB/LevelDB may keep old pages until compaction | Possible remnants on a seized device |

### 18.3 The proposal: a server-held salt per conversation

*Idea:* store a random value per conversation (1:1, group, channel) on the server, released only to
its members; the local message key becomes `KDF(local key, salt)`.

**What it gains:** a seized device whose local key is extracted cannot decrypt messages **offline**;
the server can refuse the salt to a revoked device or delete it (crypto-shredding a conversation or
an account on all devices, including stolen ones, once they try to read).

**Limitations to address:**

1. *Members' devices can always request it* — an examiner with the device and its signing key can
   act as the device and ask the server, unless the request requires a **fresh user verification**
   the examiner cannot produce (passkey/biometric). Without that, the salt adds an online step, not
   protection.
2. *The server becomes a key oracle and a single point of availability* — no reading offline; a
   compromised server (or lawful order to it) plus a seized device decrypts everything; per-request
   logs reveal reading behaviour (new metadata).
3. A per-conversation value is the wrong granularity for forensics: what must be protected is the
   **local store** as a whole (media, search index, drafts, metadata), not only message bodies.
4. "Salt" is a misnomer: it must be a secret, high-entropy **key share**, never stored with the
   device data, and not derivable from IDs.

### 18.4 Recommended design (better practice)

Defence in depth, in priority order (tracked as tasks CORE-01 / WEB-01 / AND-01):

1. **Hardware-bound, user-verified store key on Android.** Generate a non-exportable AES key in the
   Android **Keystore/StrongBox** with `setUserAuthenticationRequired(true)` (biometric or device
   credential, short validity window) and `setInvalidatedByBiometricEnrollment(true)`; wrap the
   store's key material with it and unlock through `BiometricPrompt` **with a `CryptoObject`**. The
   app lock then *is* the decryption step: a rogue app on a rooted device cannot use the key without
   the user's biometric, and copying app storage yields only wrapped keys. Combine with the
   native SQLCipher store planned in docs/mobile.md (SQLCipher 4 defaults: PBKDF2-HMAC-SHA512,
   256 000 iterations, raw key from the Keystore).
2. **Passkey-bound keys on the web (WebAuthn PRF).** Derive a key-encryption key from the passkey's
   PRF output (`prf` extension, hmac-secret on the authenticator) and wrap the store keys with it.
   Unlocking requires the passkey with user verification; a copied profile is useless without the
   authenticator. Keep the Argon2id passphrase as a fallback for authenticators without PRF.
3. **Locked chats as a separate key domain.** Encrypt a locked chat's messages, media and search
   entries under a per-chat key wrapped by (1)/(2) and never held in memory while the chat is
   locked. This is the correct form of the "per-conversation salt": per-chat keys, but **local**
   and **user-verified**, not server-held.
4. **Optional server key share for crypto-shredding (organizations that need remote kill).** Wrap
   the device's store key as `KEK = HKDF(user-verified local secret ‖ server share, "convo-store")`,
   with the **server share per device** (not per conversation) released only to an authenticated,
   non-revoked device after a fresh passkey assertion, cached in memory for the unlocked session
   only. Revoking the device or the account deletes the share: a stolen device that is imaged
   offline cannot decrypt even with the user's PIN coerced later from the OS. Make it a policy
   option because it costs offline access and adds server trust.
5. **Anti-remnant hygiene.** Seal each record with its own random data key wrapped by the store key
   so deleting a record can destroy its wrapped key (crypto-erase) even if pages linger; schedule
   IndexedDB compaction / SQLCipher `secure_delete` and `VACUUM` after bulk deletions and expiry;
   keep media and thumbnails only in memory or encrypted; never write plaintext temp files.
6. **Keep backups end-to-end only.** Continue to disable platform backups; history moves only
   through the E2EE archive to devices approved by a trusted device or the recovery kit.
7. **Duress and inactivity controls (policy).** Optional auto-wipe after N failed unlocks, and a
   policy maximum unlocked time after which keys are dropped from memory.

With (1) and (2), Convo moves from the Wickr/Signal column of the paper (device-derived or
OS-unwrappable keys) to the Threema-with-passphrase column, with stronger hardware-bound keys and
without asking users to remember another passphrase. End-to-end encryption still cannot protect an
unlocked device in the hands of an examiner who has the user's biometric or credentials.

---

## 19. Known gaps and roadmap

| Gap | Task |
|---|---|
| Interim TypeScript Signal/MLS libraries; reviewed Rust core (libsignal, OpenMLS) | FND-02, CORE-02 |
| No post-quantum keys (PQXDH/Kyber, PQ MLS) | PQ-01 |
| Android store keys not Keystore-wrapped; locks not cryptographic | §18.4 (1, 3), AND-01 |
| WebAuthn PRF unlock | §18.4 (2), WEB-01 |
| MLS credentials not bound to account identity; role profile review | GRP-01 |
| Sealed sender | PRIV-01 |
| Key transparency | TRUST-01 |
| Independent security review (SEC-02); fuzzing and plaintext scans (SEC-01) | SEC-01/02 |
| Admin console reachable publicly (consider Cloudflare Access / LAN only) | §16.3 |

## 20. Tests that guard these properties

| Test | Proves |
|---|---|
| `identity-config.spec.ts` | required actions, RP ID = hostname, UV required, exact redirect URIs, 401s |
| `chat-lock.spec.ts`, `passkey-edge-cases.spec.ts`, `passwordless.spec.ts` | passkey add/list/remove, honest result page, chat and app locks |
| `storage-lock.spec.ts`, `encryptedStore.test.ts`, `passphraseLock.test.ts` | Argon2id passphrase lock, wrong passphrase, re-sealing |
| `messaging.spec.ts`, `groups.spec.ts`, `linking.spec.ts`, `recovery.spec.ts` | E2EE delivery, MLS groups, transcript-bound linking, recovery with a wrong-code check |
| `attachments.spec.ts`, `offline-upload.spec.ts` | ciphertext-only object store, resumable uploads, digest checks |
| `calls.spec.ts` | encrypted frames reported by LiveKit, rekey on leave, removed member dropped |
| `admin*.spec.ts`, `AdminConsoleControllerTest`, `AdminPermissionsTest`, `KeycloakUsersTest`, `StepUpTest` | role matrix, step-up, self-protection, audit of every change, one-time passwords |
| `PushServiceTest` | allow-listed endpoints (SSRF), content-free wakes, retries/dead letters |
| `contracts/vectors` (Java + TS) | identical device signatures and enrollment transcripts |
| `tests/e2e/smoke` (production, after every deploy) | issuer, security headers, hidden consoles, 401s, admin-origin isolation, real passkey registration and passkey-only sign-in |

Keeping this document current is part of the definition of done: a change to cryptography,
storage, identity, network exposure or the admin model updates the matching section and, if it
changes a guarantee, its test.
