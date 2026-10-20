# Implementation progress

Running log of implemented work, mapped to the task IDs in [docs/tasks.md](docs/tasks.md).
`docs/tasks.md` acceptance checkboxes stay open until their full acceptance evidence exists; this
file tracks what is actually built, verified, and what is still missing.

Legend: ✅ done and verified · 🟡 partial (see notes) · ⬜ not started

## Active checkpoint — 2026-10-20

- Native Compose Android client and APK are implemented and committed; Android↔web encrypted
  exchange, trusted linking/history restore, and update/process-restart persistence are verified
  on emulator-5554. Full parity, physical devices, native storage certification and iOS remain open.
- Native global Media gallery/filter/batch actions, Settings All Media, requested five footer tabs,
  shared web light/dark tokens, success feedback and encrypted drafts are now implemented.
- Backend advertises/enforces a configurable 100 MiB attachment policy; clients apply its plaintext
  limit before reading files. Encryption tags/padding have a separate bounded ciphertext allowance.
- `convo.doncea.ro` is mapped locally to `192.168.1.144`; HTTPS exposes both 443 and 8443, with a
  matching self-signed SAN certificate. Keycloak uses this domain as the passwordless RP ID.
  WebAuthn registration followed by a genuine passwordless assertion is E2E verified in Chromium.
- Responsive Convo Keycloak login theme and editable required telephone input are implemented.
  Web Settings no longer exposes a separate Security category; confirmed red Log out remains.
- Shared safety-number display preserves existing pinned-library bytes and avoids Firefox's
  slow timer-per-digest path. Compatibility and focused Firefox UX tests pass.
- Edit policy (ADR-0005): 15 min chats / 30 days channels from `/v1/deployment-info`, enforced by
  receivers with server timestamps; revisions, per-revision receipts and silent edits. Web unit
  tests, Chromium/Firefox `edit-policy.spec.ts`, Android edit/"edited" checked on emulator-5554.
- Profile photo/status saves are serialized with their broadcasts; oversized attachments disable
  Send before upload (`attachment-policy.spec.ts`). Full suite: 46 passed, 2 skipped.
- Media auto-download (Storage and data) on web and Android, Android Save to gallery via
  MediaStore. `auto-download.spec.ts` (Chromium/Firefox); emulator: manual photo download and
  Pictures/Convo export verified.
- Calls (ADR-0006): self-hosted LiveKit SFU + coturn in Compose, `calls` backend module (room
  authorization, per-device LiveKit JWTs), E2EE ring/accept/decline/cancel/end messages with a
  per-call media key, LiveKit frame encryption (no unencrypted fallback), web call screen,
  header call buttons and Calls history. `calls.spec.ts`: voice answer/end + video decline,
  LiveKit-reported encrypted frames, Chromium and Firefox. Android: livekit-android 2.29.0 call
  screen, ringtone/vibration, voice/video buttons, Calls tab; emulator-5554 ↔ Chromium verified
  both directions (voice and video), both SDKs report encrypted frames, hang-up ends both sides.
- Passkeys: Settings → Privacy shows IdP passkey status (read-only `convo-credential-status`
  service account, `GET /v1/account/credentials`) and opens the Keycloak Account Console.
  Verified with a real Chromium WebAuthn passkey on `convo.doncea.ro`.
- Android Privacy: passkey status, Manage passkeys (Custom Tab), BiometricPrompt app lock and
  per-chat locks, enabled only after the IdP confirms a passkey. Locked chats are hidden from the
  list, search, global media, forwarding and gallery saving; grants end on background / leaving
  the chat. Emulator: cancel keeps locks off, PIN unlock, lock screen before content on resume,
  APK replacement keeps locks.
- Android voice notes: mic ↔ send composer, pause/resume, 15-min cap, Opus/OGG (AAC fallback
  below Android 10), "Voice message · duration" tiles. Sent and replayed on emulator-5554.
- Passwordless from Settings (web + Android): Keycloak `webauthn-register-passwordless` action in
  a new tab / Custom Tab, returning to `/auth/convo/passkey-done`. With a passkey, any chat (direct,
  group, Note to self, channel) can require authentication to open from the chat list's ⋮ menu
  (replaces the arrow), the chat menu and chat info. Web verifies with the passkey (WebAuthn user
  verification); Android with fingerprint/face/screen lock. `chat-lock.spec.ts` (Chromium virtual
  authenticator on convo.doncea.ro); emulator: ⋮ lock and info-page unlock verified.
- Still open: full localization, cross-message viewer navigation,
  web screen lock, background call ringing (push), remaining UI parity and legacy-origin migration.

## Foundations (FND)

| Status | Item | Task | Notes |
|---|---|---|---|
| ✅ | Spring Boot 4.1 / Spring Modulith 2.1 backend skeleton, Java 21, virtual threads | FND-03 | `server/` |
| ✅ | Module boundary verification (`ApplicationModules.verify()`) + generated module docs | FND-03 | `ModularityTests` |
| ✅ | React 19 + TypeScript + Vite web skeleton | FND-03 | `apps/web/` |
| ✅ | Browser Signal sessions (interim TS library, X3DH + Double Ratchet) proven in tests | FND-02 | PQXDH/Kyber pending Rust/WASM gate |

## Identity (ID-01)

| Status | Item | Notes |
|---|---|---|
| ✅ | JIT account provisioning from `(issuer, sub)`, handle derivation with diacritic folding | |
| ✅ | Device reservations (never-reused IDs, 10-min single-use challenge) | |
| ✅ | First-device registration with signed enrollment transcript, idempotent retry | |
| ✅ | Device proof-of-possession request signatures (ECDSA P-256, replay cache) | client-chosen request ID instead of server nonce (PRIV-02 follow-up) |
| ✅ | Signed/one-time prekey upload, status, atomic single-use claims, KEYS_LOW | Kyber prekeys pending |
| ✅ | Directory search by handle, device rosters, own-device list/unlink/self-revoke | |

## Messaging (MSG-01)

| Status | Item | Notes |
|---|---|---|
| ✅ | Idempotent direct submissions (digest dedupe, IDEMPOTENCY_CONFLICT) | |
| ✅ | All-or-nothing roster validation (DEVICE_MISMATCH / STALE_DEVICES) | |
| ✅ | Per-device mailbox, oldest-first drain, scoped acks, expiry & revocation purge | single table; partitioning later |
| ✅ | WebSocket gateway: one-use origin-bound tickets, bounded in-flight drain, ping safety net | |
| ✅ | Valkey `mail:*` / `ctl:*` hints + presence, local fallback | |
| ✅ | Persistent Modulith listeners for revocation / device-list / keys-low directives | |

## Web client

| Status | Item | Notes |
|---|---|---|
| ✅ | Encrypted IndexedDB store (AES-GCM records, HMAC key pseudonyms, atomic batches) | passphrase lock pending |
| ✅ | Content schema + padding + unknown-content placeholders | |
| ✅ | Signed HTTP client, resilient WebSocket (tickets, ping, jittered reconnect, 4401) | |
| ✅ | Browser-primary enrollment with pending-enrollment persistence and idempotent retry | |
| ✅ | Multi-device Signal fan-out (claims, registration-ID rebuild, DEVICE_MISMATCH/STALE handling) | |
| ✅ | Durable outbox: queued → ready → accepted, same-ciphertext retries, blocked/failed + Retry | |
| ✅ | Decrypt → atomic commit (ratchet + message + processed marker) → ack; GUID + semantic dedupe | |
| ✅ | Text, safe formatting, replies, reactions, author edit, delete-for-everyone, delete-for-me | |
| ✅ | Delivery receipts (on), read receipts and typing (off by default, settings) | |
| ✅ | Note to self, own-device sync transcripts and read cursors | |
| ✅ | Conversation list: search with diacritic folding, pin, mute, archive, unread, drafts | |
| ✅ | Safety numbers (5200 iterations), verify/clear, identity-change notice, blocked sends | |
| ✅ | Settings: theme, EN/RO language, receipts/typing, devices + unlink, sign-out wipe | |
| ✅ | Cross-tab leader lock (Web Locks, "Use here"), revoked/storage-lost/update/unreachable states | |
| ✅ | Strict CSP + security headers, same-origin nginx proxy | |

## Device linking (ID-02)

| Status | Item | Notes |
|---|---|---|
| ✅ | Provisioning sessions: E2EE ProvisionMessage relay, single-use code hash, expiry, cancel/decline | |
| ✅ | `POST /v1/devices/link`: Keycloak token **and** approving-device code required; IK must match account | |
| ✅ | X25519 → HKDF → AES-GCM channel bound to `ENCLAVE-PROVISION-V1` transcript (AAD) | WebCrypto X25519 |
| ✅ | 12-digit comparison code on both screens; approve/decline in Settings | QR scan alternative pending |
| ✅ | Shared enrollment completion path (primary + linked), linked devices restore the account encrypted archive | legacy old-origin migration pending |
| 🟡 | Own-device notices on link (`DEVICE_LIST_CHANGED` directive refreshes device list) | persistent security notice UI pending |

## Attachments (FEAT-01)

| Status | Item | Notes |
|---|---|---|
| ✅ | `attachments` module: presigned PUT (exact size) / GET via SeaweedFS, no uploader column, retention purge | |
| ✅ | STREAM/AES-256-GCM chunked encryption, authenticated header + final flag, size-bucket padding, digest-before-decrypt | needs SEC-02 review |
| ✅ | Image re-encode strips EXIF/location; safe download content types (no active content) | |
| ✅ | Composer: file picker, drag & drop, paste, size limit feedback, upload progress, captions | |
| ✅ | Photos render inline (decrypted in memory), files download on explicit action; expired/offline/integrity states | |
| ⬜ | Albums (2–10 photos grid), thumbnails/blurhash, voice notes, resumable multipart uploads, offline-queued uploads | FEAT-01/EXT-02 |

## Groups (GRP-01/02/03)

| Status | Item | Notes |
|---|---|---|
| ✅ | MLS KeyPackages: upload/status/single-use claim, KEYPACKAGES_LOW, revocation cleanup | |
| ✅ | Groups module (MLS Delivery Service): create, epoch-CAS ordered commits, idempotency, events, role ACL mirror, fan-out | |
| ✅ | Browser MLS via `ts-mls` (RFC 9420, X25519/AES-128-GCM/Ed25519) with portable pure-JS crypto provider | interim FND-02 stand-in |
| ✅ | Authenticated group senders (leaf credential must match server-reported source device) | |
| ✅ | Create group, encrypted group name, add/remove members (admin/owner), removed-member state | |
| ✅ | Linked-device sync: own devices added/removed in joined groups on DEVICE_LIST_CHANGED | |
| ⬜ | Leave (proposal flow), promote/demote/transfer UI, invite links, join requests, bans, pins, timers | GRP-03, EXT-03 |
| ⬜ | Credential binding to account identity key, reviewed role profile, pending-removal gate | GRP-01 |

## Delivery & verification

| Status | Item | Notes |
|---|---|---|
| ✅ | Root `docker-compose.yaml`: Postgres, Valkey, Keycloak (realm import), SeaweedFS, server, web | |
| ✅ | Playwright e2e (Chromium + Firefox): enrollment, bidirectional E2EE chat, receipts, reactions, edit, delete, offline mailbox delivery, Note to self, device linking, encrypted photo/file exchange, ciphertext-only object store, MLS groups | 14/14 passing |
| ✅ | Shared Java/TypeScript contract vectors for device signatures and enrollment transcripts | `contracts/vectors` |

## Fixed along the way

* Composer cleared text typed while the previous message was being persisted (race) — fixed by
  clearing optimistically and restoring only on local failure.
* Unreadable local keys left an endless spinner — now shows a "set up this browser again" state.
* Keycloak advertised the nginx-internal port in its endpoints — proxy now forwards `Host:port`.
* Group reads used row locks inside read-only transactions (PostgreSQL rejects `FOR SHARE`).
* Firefox rejected MLS commits via WebCrypto X25519 — switched MLS to a portable pure-JS provider.

## Next up

| Item | Task |
|---|---|
| QR display/scan for linking, persistent own-device security notices | ID-02 |
| Albums, voice notes, resumable uploads | FEAT-01 |
| Passphrase lock for browser storage | WEB-01 |
| Group leave/roles/invites, communities | GRP-03, COM-01/02 |
| Durable push/notification intents (outbox table + workers) | MSG-02 |
| Admin console, audit log, policies | ADM-01 |
| Server-issued nonces for device proofs, Kyber prekeys | PRIV-02, FND-02 |

## Web UX refresh (ADR-0003) — 2026-10-20

| Status | Item | Notes |
|---|---|---|
| ✅ | Logo/wordmark (`docs/assets`), splash with E2EE notice + progress (≥ 1 s) | |
| ✅ | Neutral messenger theme with brand accents, contrast tests, Inter bundled | |
| ✅ | Rail, chat list filters, new chat / group wizard / settings panels, info drawer, home quick actions | |
| ✅ | URL navigation (refresh/back restore view) | |
| ✅ | Message menu (react, reply, copy, forward, star, edit, delete), emoji picker, attach menu | |
| ✅ | Voice notes (mic ↔ send), video with posters, pre-send media preview | |
| ✅ | Directory search by name/handle/phone (ADR-0002), pgAdmin | |
| ✅ | Global search across decrypted message text and attachment names | UX E2E |
| ✅ | LAN HTTPS, dynamic Keycloak hostname and request-origin file links | hostname/IP E2E |
| 🟡 | Firefox e2e: intermittent enroll wait timeout (KeyPackage upload response) | investigate |

## Convo LAN and account continuity — 2026-10-20

| Status | Item | Evidence |
|---|---|---|
| ✅ | HTTPS on 8443, HTTP help on 8088, persistent certificate, dynamic Keycloak/JWT/S3 origins | LAN HTTP 200 / HTTPS 200; Chromium enrollment, file transfer and forwarding-header checks |
| ✅ | Convo UI branding; message-text/file-name search across local history; chat-row actions; beside-message menus | 117 web unit tests; focused Chromium UX journeys |
| ✅ | Encrypted media/docs/links gallery with routed tabs, downloads and month grouping | Existing attachment journey extended; Chromium and Firefox passed before recovery batch |
| ✅ | Channels backed by groups with admin-only posting; Calls rail placeholder | Backend role-denial test and Chromium owner/member journey |
| ✅ | Durable encrypted account archive, atomic local journaling, idempotent append, stable pagination and device restoration | Chromium restores historical sent/received/self messages with original browser closed |
| ✅ | Recovery code with separately derived wrapping/authorization keys; same-identity recovery and lost-device revocation | Chromium wrong-code rejection and fresh-browser recovery, device count 1 |
| ✅ | Expanded Settings, encrypted profile photo/status, wallpaper previews and guarded Log out | Dedicated Chromium/Firefox settings journey passed |
| ✅ | Keycloak data persists across container replacement; bogdan/bogdan and maria/maria created | Running realm checked after restart |

Validation checkpoint: backend tests/module boundaries passed, web type checks and 117 unit tests
passed; 4 existing Chromium messaging journeys and 5 focused recovery/UX journeys passed. Full
Chromium/Firefox regression will run again after this checkpoint. ADR-0004 records remaining
security review, deployment-backup and group-join limits. Existing HTTP-origin IndexedDB data
requires explicit migration to the HTTPS origin; browser origins do not share local storage.

Additional requested work in progress: clickable links with an optional redirect confirmation,
richer conversation info/actions, old-origin migration, native Android with emulator/ADB evidence
and APK in `apps/assets`, followed by iOS. See the implementation plans in `docs/superpowers/plans`.
