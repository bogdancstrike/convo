# Implementation progress

Running log of implemented work, mapped to the task IDs in [docs/tasks.md](docs/tasks.md).
`docs/tasks.md` acceptance checkboxes stay open until their full acceptance evidence exists; this
file tracks what is actually built, verified, and what is still missing.

Legend: ✅ done and verified · 🟡 partial (see notes) · ⬜ not started

## Active checkpoint — 2026-10-22

- [x] Admin console on its own origin (`convo-admin.doncik.ro`, `apps/admin`, React 18 + Ant Design
  5 + ECharts + React Flow): overview, people (activity, devices, sign-in, security), sign-in
  accounts (create with one-time password, reset, required actions, sign out, block, roles,
  audit), activity (days used per platform, senders vs readers, levels, weekday), roles &
  permissions (holders, permission map, access flow), audit (search, verify, checkpoint, export),
  health (push, redrive). Every change audited with a reason; step-up and no self-changes;
  `convo-admin-ops` Keycloak client limited to user management. `/admin` removed from the
  messenger. e2e `admin*.spec.ts`, server unit tests, production smoke checks of the origin.
- [x] Statistics: encrypted items and "used Convo" per account/day/platform (V25, V26; 90 days;
  `enclave.admin.activity.enabled`).
- [x] Calls in production: diagnosed (callers outside the LAN have no media path until the router
  forwards UDP 50000–50100 / TCP 7881 / coturn ports and `turn.doncik.ro` resolves); LiveKit
  offers only the LAN interface; dropped calls end with an explanation (web + Android, e2e).
- [x] Push in production: ntfy accepts anonymous `up*` topics; deployment info advertises push
  servers; Android Settings → Notifications shows background delivery status and fixes.
- [x] docs/SECURITY.md: full security description, ports/firewall, forensic analysis (Son et al.
  2022) with recommendations (Keystore-bound and PRF-bound store keys, per-chat keys).
- [x] Android UI pass (WhatsApp layout, Convo web style): sources split into packages that mirror
  `apps/web/src/ui` (app, bridge, ui.chats/thread/info/contacts/communities/settings/media/locks/
  linking/components/theme, calls, push, i18n); chat list (time, You:/author, badges, Archived
  row, FAB, overflow), conversation (avatar header, wallpaper, encryption pill, day chips, grouped
  bubbles with tails, inline time/ticks, long-press options, pill composer + round send/mic),
  info pages (hero + Voice/Video/Search, sections, red actions), settings home, calls (recent,
  New call), communities, new chat; light/dark system bars. Checked light and dark on
  emulator-5554 against the local stack (`adb reverse`, debug cert pinned by `build-apk.sh`).
  APK rebuilt; README documents building it.
- [x] Docs diagram: architecture and trust boundaries (`docs/diagrams/security/architecture.*`).
- [x] Web Push for closed browser tabs (MSG-02): opt-in "Notify me when Convo is closed"; empty
  VAPID-signed wakes to allow-listed push services, `/sw.js` generic notification, start-up
  re-registration, `deploy/vapid-keys.sh`. `PushServiceTest` (allow-list, verified ES256 JWT,
  TTL/Urgency); `web-push.spec.ts` delivers a real wake through Mozilla autopush to a closed
  Firefox tab and checks that turning it off stops them.
- [ ] Open from this checkpoint: router forwards + `turn.doncik.ro` DNS (user), Keystore/PRF-bound
  local keys (SECURITY.md §18.4).
- [x] Docs diagrams (diagram-design, Convo profile): message flow (Signal, per-device fan-out),
  calls (LiveKit SFU + coturn, frame E2EE), network exposure (tunnel, router forwards,
  ClusterIP); linked from README and SECURITY.md.
- [x] Android follow-ups: long-press menu with reaction bar (SelectionContainer removed so the
  gesture reaches the bubble), reactions as a pill on the bubble edge, call screen (encryption
  line, control tray), photos with their own aspect ratio and caption below, black media viewer.

## Active checkpoint — 2026-10-21 (earlier)

- [x] 2026-10-21 Deployment: hostname `convo.doncik.ro`, no fixed IPs in the repo (`CONVO_SERVER_IP`
  required from `.env`); web image runs behind a Kubernetes ingress (`CONVO_TLS=off`, `UPSTREAM_*`,
  `CONVO_KEYCLOAK_ADMIN=off`); production Keycloak image (theme, realm without dev users, setup
  script); GitHub Actions publish `convo-server`, `convo-web`, `convo-keycloak` to Docker Hub on
  every push; homelab charts `app-charts/convo` + `charts/livekit` + `charts/coturn` (shared
  Postgres/Redis/MinIO/ntfy, cloudflared route). See `deploy/k8s.md`.

- Native Compose Android client and APK are implemented and committed; Android↔web encrypted
  exchange, trusted linking/history restore, and update/process-restart persistence are verified
  on emulator-5554. Full parity, physical devices, native storage certification and iOS remain open.
- Native global Media gallery/filter/batch actions, Settings All Media, requested five footer tabs,
  shared web light/dark tokens, success feedback and encrypted drafts are now implemented.
- Backend advertises/enforces a configurable 100 MiB attachment policy; clients apply its plaintext
  limit before reading files. Encryption tags/padding have a separate bounded ciphertext allowance.
- Deployment hostname `convo.doncik.ro` (Kubernetes: public through the Cloudflare tunnel; Compose:
  a hosts/LAN-DNS entry to the Docker host, HTTPS on 443 and 8443 with a self-signed SAN
  certificate). Keycloak keeps the passwordless RP ID equal to the hostname. WebAuthn registration
  followed by a genuine passwordless assertion is E2E verified in Chromium.
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
  Group voice calls (3 participants, encrypted, leaving keeps the call for others) pass in
  Chromium and Firefox.
- Passkeys: Settings → Privacy shows IdP passkey status (read-only `convo-credential-status`
  service account, `GET /v1/account/credentials`) and opens the Keycloak Account Console.
  Verified with a real Chromium WebAuthn passkey on `convo.doncik.ro`.
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
  authenticator on convo.doncik.ro); emulator: ⋮ lock and info-page unlock verified.
  2026-10-21: production fix — the imported realm lacked the passkey required action (Keycloak
  returned `kc_action_status=error` while the page claimed success); setup now registers required
  actions, the result page reads the real status, and Settings lists/adds/removes passkeys via
  Keycloak actions instead of the account console (hidden in production).
- Android media viewer pages through every photo/video of the chat (Previous/Next and swipe),
  like the web viewer; documents/audio open alone. Verified on emulator-5554.
- Full regression 2026-10-21: 54 passed, 4 skipped (hostname-only passkey specs); the stale
  Calls-placeholder assertion in `ux.spec.ts` now checks the real Calls panel.
- Android localization: native UI follows the shared EN/RO `settings.locale` live (`I18n.kt`:
  package-level Text/Icon shadows translate UI strings; user content uses RawText). Media
  previews are localized on both clients. Verified on emulator-5554 in Română.
- Web app lock: Settings → Privacy "Lock Convo with passkey" (needs a passkey), locks on open
  and after Immediately/1/5/15 min in the background; nothing renders behind the lock.
  `chat-lock.spec.ts` covers failed and successful user verification.
- Disappearing messages (specs §17): per-chat Off/24 h/7 d/90 d timer as an authenticated E2EE
  event (groups/channels: owners/admins, enforced by receivers; newest change wins), timer
  notices, bubble badges, sent messages expire from sending and received ones from first read,
  30 s sweeper with suppression markers, expired archive entries never restored. Web and
  Android; `disappearing.spec.ts` (Chromium/Firefox, simulated 24 h) and emulator checks.
- Blocking contacts (FEAT-02): block/unblock from chat menus on web and Android; blocked
  contacts' direct content (messages, calls, typing, receipts, profile) is dropped without
  receipts, sending/calling is refused, banner offers Unblock; flag travels with the encrypted
  conversation archive (last change wins). Conversation updates are now serialized with envelope
  processing (fixed a lost-update race). `blocking.spec.ts` Chromium/Firefox; emulator checked.
- @mentions in groups (FEAT-02): composer suggestions (keyboard/touch), structured mention IDs
  in E2EE content (members only), highlighted mentions, @ badge until read. Web and Android;
  `mentions.spec.ts` Chromium/Firefox; Android→web mention verified (badge + highlight).
  Fixed caret placement after picking a suggestion on both clients.
- Shared message pins (FEAT-02): up to 3 per chat as authenticated E2EE events (groups/channels:
  owners/admins, enforced by receivers); pinned banner that jumps/cycles and unpins; deleted
  targets never resurface. Web and Android; `pins.spec.ts` Chromium/Firefox; emulator checked.
- Message notifications (FEAT-02/MSG-02 groundwork): opt-in per device, generic preview by
  default (sender / sender+text optional), locked chats and app lock force generic, muted chats
  silent, groups can be set to "mentions only" (verified structured mentions). Web Notification
  API (`notifications.spec.ts`, Chromium/Firefox) and Android channel + POST_NOTIFICATIONS with a
  generic lock-screen version and tap-to-open; verified on emulator while running in the
  foreground. Optional Android "Stay connected in the background" foreground service
  (`remoteMessaging`, visible ongoing notification) keeps delivery working in the background —
  verified: a message sent while Convo was on the home screen produced a notification. Push for a
  stopped app: UnifiedPush through a self-hosted ntfy (Compose `ntfy`, server `push` module, V19).
  Offline devices (no session, no presence) get a constant content-free wake, rate-limited, only
  to allow-listed distributor origins; Android shows a generic "New message". Verified on the
  emulator with the ntfy app: process killed → web message → app woken, notification shown; no
  wake while connected. Call ringing via push: rings are sent `urgent`; an urgent wake shows a
  ringing generic "Incoming call" (full-screen intent); verified: killed app → web call → ring
  notification → tap → Accept → connected, encrypted. Socket close clears presence at once.
  Failed wakes are retried with backoff (verified by stopping ntfy during a send); vanished
  endpoints are forgotten and re-registered by the app. Durable wake intents (V24): recorded in
  the envelope transaction, leased by polling workers (`SKIP LOCKED`), retried with backoff,
  sanitized dead letters (24 h) with an admin Health tab and audited redrive. Verified: ntfy down
  → 3 attempts → server restart → ntfy back → delivered; 4 failures → `gave_up` → security
  operator redrive → delivered. FCM (Google devices without a distributor) remains open.
- Communities slice 1 (COM-01/02, V21): community = admin-only announcement channel registered
  as root; link groups with both authorities (community admin proposes, group owner accepts;
  owner of both links at once), one parent, no nesting, members must already be in the community;
  discoverable vs private links; members see discoverable groups by E2EE label (published in
  the root metadata by an admin who is in the group) and ask to join (normal approval); private
  names never broadcast. Web Communities panel (list/create/detail, add group, accept, unlink).
  Verified `communities.spec.ts` (Chromium/Firefox, repeated) + server unit tests. Android:
  Communities tab (Unread became a chat-list chip), create/detail/add group/accept/ask to join;
  emulator-verified against a web community (label, request → approval → open group, read-only
  announcements, Back returns to the community, create with description).
- Announcement acknowledgements (specs §30.6): admins tick "Ask members to acknowledge"; members
  press "I acknowledge this announcement" and see who receives it (publisher + owners); response
  is a typed E2EE `ack` to each reviewer + own devices (pending → sent), never a post, works with
  read receipts off; reviewers see "Acknowledged N of M" and per-member state; editing the
  announcement invalidates earlier responses ("Updated — please acknowledge again"). Web
  `acknowledgements.spec.ts` (Chromium/Firefox, repeated); Android emulator acknowledged a web
  announcement and the reviewer count updated. Optional due and closing times (web + Android):
  members see both, responses after the due time are marked late, none are accepted after closing
  (server acceptance time decides). Not yet: withdraw, custom reviewer selection.
- Groups created inside a community (WhatsApp-style, 2026-10-21): community admins create a new
  group from the community page (name, description, community members to add, visible/hidden,
  follow community removals); it is linked at once and opens. Redesigned web community page (hero,
  announcements card, tools, groups section with New group / Add existing) and Android dialog;
  Android footer labels stay on one line. `communities.spec.ts` (create-in-community test).
- Community onboarding (specs §30.7): admins edit "Welcome & rules" (welcome text, rules with
  optional acknowledgement, recommended groups, checklist presets + custom, required/optional);
  members get a welcome card with a private checklist (own-device sync), versioned rules
  acknowledgement to the named reviewers ("Updated rules — review and acknowledge" on a new
  version; other progress kept), recommendations via ask-to-join, "Continue later"/"You're all
  set". Web `onboarding.spec.ts` (repeated, 4 workers); Android member flow emulator-verified
  (tick + rules ack → reviewer count). Fixed on the way: a re-entrant mutex deadlock in the
  outbox acceptance callback, `refreshRecord` overwriting concurrent E2EE metadata, and history
  merges dropping acknowledgement state. Android has the editor too (Community → Welcome &
  rules; emulator-verified save → welcome card).
- Reading position (specs §30.8 unread catch-up): device-local anchor (message + offset) in the
  encrypted store, never journaled/synced; restored when a chat opens without new unread, across
  reload; "Back to where you were" after jumping to the latest; expired/deleted anchors fall back
  with an explanation. `reading-position.spec.ts` (Chromium/Firefox).
- Timed conversation snoozing (specs §30.8, FR-NOTIF-01): presets This evening / Tomorrow
  morning / 1 h / 4 h / custom, exact time + time zone shown before confirming; an overlay on the
  mute/mentions mode (which resumes); alerts paused, messages still arrive and count; End snooze;
  E2EE own-device sync (`sync.snooze`, higher mutation wins), expiry persisted so stale sync or
  clock rollback cannot revive it. Web + Android (menu, dialog, list icon). `snooze.spec.ts`
  (Chromium/Firefox), `snooze.test.ts`, emulator.
- Rich group descriptions (specs §30.8): E2EE About text (≤ 8 KiB, safe formatting, links shown,
  no HTML) and rename for owners/admins on web and Android; receivers accept group metadata only
  from owners/admins (re-reading roles once for fresh promotions). `group-about.spec.ts`
  (Chromium/Firefox, incl. markup shown as text), group suites green, emulator edit.
- Fast accessible actions (specs §30.8): web shortcuts on a focused message (Enter menu, R reply,
  E edit, S star, F forward, I info, Delete → confirmation, ↑/↓ move), never in text fields, IME
  composition or with modifiers, listed in Settings → Chats; focus returns to the message after the
  menu closes. Android swipe-right-to-reply (horizontal drags only, haptic at threshold, honours
  reduced motion; "Reply" menu item remains). `shortcuts.spec.ts` (Chromium/Firefox), emulator.
- Member search & groups in common (specs §30.8): group info has a local roster search
  (case/Romanian-diacritic-insensitive), All/Admins filters (owners included) and an accessible
  "N of M members" count on web and Android; direct-chat info on web also lists groups in common
  (local intersection, nothing uploaded). `member-search.spec.ts` (Chromium/Firefox), `text.test.ts`,
  Android emulator check.
- Scoped admin roles (ADM-01, AC-ADM-01/03): helpdesk / org admin / security / auditor realm
  roles with a least-privilege permission matrix enforced per endpoint; denied sensitive attempts
  audited; console shows only permitted tabs/actions (`/v1/admin/me`); accountable audit export
  (reason recorded first). `admin-roles.spec.ts` (Chromium/Firefox) + unit tests.
- Parent-removal delegation (specs §30.3, V22): owners opt a linked group into "remove people here
  when they leave the community" (link/accept); leaving or being removed from the community
  marks them departed in those groups (fan-out stops at once, `GROUPS_CHANGED` hint, a member's
  client commits the MLS removal), last owners are never stranded (blocked operation), and
  admins see "Membership updates". Web `community-removal.spec.ts` (Chromium/Firefox); Android
  emulator: removed from the community → "You are no longer a member" in the delegating group,
  no later messages.
- Browser passphrase lock (WEB-01): Settings → Privacy → Browser passphrase wraps the storage
  keys with Argon2id (64 MiB, t=3; `hash-wasm`); first activation re-seals the whole local store
  and adds an outer pseudonym layer. Locked start shows only the unlock screen (wrong passphrase,
  "forgot" → set up again); "Lock now" and auto-lock after 1/5/15/60 min (default 5) reload to drop
  keys from memory; change/remove. Verified `storage-lock.spec.ts` (Chromium/Firefox, repeated).
  Not covered: WebAuthn-PRF unlock, closing already-shown system notifications on lock.
- Group call key rotation (ADR-0006): whenever someone leaves a group call the smallest remaining
  identity sends an MLS-encrypted `rekey` (generation → key index), web and Android; members
  removed from / leaving the group are kicked from open call rooms by the server (LiveKit
  RoomService) and cannot get the new key. Verified: `calls.spec.ts` (removed member dropped,
  generation advances; leave → rekey) in Chromium/Firefox, and an emulator group call where the
  Android device applied and led rekeys while the web side stayed encrypted.
- Resumable uploads (FEAT-01): ciphertext above 8 MiB goes up as S3 multipart parts (V20) gated by
  a per-upload secret; parts are retried, and an interrupted upload is queued with its key/nonce
  seed + session so the resume re-creates identical ciphertext and sends only missing parts.
  Verified (`offline-upload.spec.ts`, Chromium/Firefox): 20 MiB file, part 3 cut → queued →
  resumed without re-sending parts 1–2 → recipient download byte-identical. Unit tests on both sides.
- Batch selection (FEAT-02): select up to 100 messages to copy, star, forward to one chat or
  delete for me (confirmed, partial outcomes reported). Web (`selection.spec.ts`) and Android
  (message menu → Select); emulator verified.
- Full regression 2026-10-21 (later): 67 passed, 1 flaky (Firefox last-seen timing), 4 skipped.
- First-unread navigation (FEAT-03, web): chats open at an "N unread messages" divider (anchor
  frozen at open), a jump-to-latest button with a new-message count appears when scrolled up.
  `unread-navigation.spec.ts` Chromium/Firefox. Android: same divider, start position and
  jump-to-latest button with new-message badge; verified on emulator with 30 unread messages.
- Leaving groups/channels (GRP-03): E2EE "left" notice, server takes the account out of the ACL
  and fan-out at once (`mls_group_departures`), any remaining member commits the MLS Remove;
  the sole owner must hand over first. Web and Android; `group-leave.spec.ts` Chromium/Firefox
  (DB confirms departures completed and leaver devices removed); emulator verified.
- Invite links and join requests (GRP-03): hashed bearer links with expiry and reset, join
  requests that reveal nothing about the group, admin approve (MLS add) / decline. Web
  (`#/join/<token>`, `invites.spec.ts` Chromium/Firefox) and Android (info section, "Join with
  invite link"); phone joined a browser-created group via link after approval.
- Group bans (GRP-03, V17): admins "Remove and ban"; banned accounts cannot be re-added and their
  join requests look like invalid links; banned list with Unban. Web E2E (in `invites.spec.ts`);
  Android verified on the emulator (2026-10-21): as a promoted admin it used "Remove and ban" →
  web saw the member removed and listed as banned, and her join request via a new link was
  refused; Android "Unban" cleared the server ban (`mls_group_bans`) and its banned list.
- Linking QR (ID-02): new devices show the comparison code as a QR (`convo-link:<digits>`), web
  E2E decodes it with jsQR and matches the digits; Android trusted devices scan it (ZXing) to
  pick the matching request, still confirming before approval. Real camera scan needs a
  physical device.
- Photo albums (FEAT-01): 2+ photos/videos in one message show as a 2-column grid of up to four
  tiles with "+N"; the viewer pages through all. Web (`albums.spec.ts`) and Android (emulator:
  5-photo album, viewer at 4 / 5). Singular "1 unread message" divider on both clients.
- Encrypted image thumbnails (FEAT-01): senders embed a ≤32 px JPEG inside the E2EE pointer;
  receivers show it blurred while loading or before a manual download (web + Android).
- Offline-queued uploads (FEAT-01): attachments/voice notes sent without network are kept in the
  encrypted store with a "waiting for connection" placeholder that already has the final message
  ID; uploaded and sent on reconnect (no duplicates). Fixed: binary data must be stored as
  base64url (the store serializes JSON). `offline-upload.spec.ts` Chromium/Firefox.
- Message requests (FEAT-02): first direct contact from someone new is a request (no read
  receipts, typing or profile sharing) with Accept/Block; replying accepts. Web
  (`requests.spec.ts`) and Android (emulator: Request tag, banner, accept).
- Full regression 2026-10-21 (evening): 80 passed, 0 failed, 0 flaky, 4 skipped (hostname-only).
- Admin console (ADM-01, first slice): `admin` module + `/admin` page for Keycloak role
  `convo-admin`; account search, disable/enable and device revoke with mandatory reasons, each
  committed with a hash-chained audit entry (V18) and a verify endpoint. No access to chat data.
  Chain heads are checkpointed to an independent append-only file (volume `audit-checkpoints`);
  verification also compares the database against every checkpoint. Step-up: sensitive actions
  need a sign-in at most 10 minutes old (`STEP_UP_REQUIRED`, unit-tested).
  `admin.spec.ts` Chromium/Firefox (role required, disabled device denied, chain intact).
- Still open: physical-device/accessibility testing, legacy-origin migration, and the items in
  "Next up" below.

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
| ✅ | Device proof-of-possession request signatures (ECDSA P-256, replay cache) and single-use server nonces (profile V2, PRIV-02) | |
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
| ✅ | Encrypted IndexedDB store (AES-GCM records, HMAC key pseudonyms, atomic batches) and Argon2id passphrase lock | WebAuthn-PRF unlock optional |
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
| ✅ | 12-digit comparison code on both screens; approve/decline in Settings; QR code on the new device, Android QR scan to approve | qrcode (web), ZXing (Android) |
| ✅ | Shared enrollment completion path (primary + linked), linked devices restore the account encrypted archive | legacy old-origin migration pending |
| ✅ | Own-device notices on link/removal: persistent security notices in Note to self (deterministic IDs, archive-safe) | web + Android, linking E2E |

## Attachments (FEAT-01)

| Status | Item | Notes |
|---|---|---|
| ✅ | `attachments` module: presigned PUT (exact size) / GET via SeaweedFS, no uploader column, retention purge | |
| ✅ | STREAM/AES-256-GCM chunked encryption, authenticated header + final flag, size-bucket padding, digest-before-decrypt | needs SEC-02 review |
| ✅ | Image re-encode strips EXIF/location; safe download content types (no active content) | |
| ✅ | Composer: file picker, drag & drop, paste, size limit feedback, upload progress, captions | |
| ✅ | Photos render inline (decrypted in memory), files download on explicit action; expired/offline/integrity states | |
| ✅ | Albums, voice notes, encrypted thumbnails, offline-queued and resumable multipart uploads | FEAT-01/EXT-02 |

## Groups (GRP-01/02/03)

| Status | Item | Notes |
|---|---|---|
| ✅ | MLS KeyPackages: upload/status/single-use claim, KEYPACKAGES_LOW, revocation cleanup | |
| ✅ | Groups module (MLS Delivery Service): create, epoch-CAS ordered commits, idempotency, events, role ACL mirror, fan-out | |
| ✅ | Browser MLS via `ts-mls` (RFC 9420, X25519/AES-128-GCM/Ed25519) with portable pure-JS crypto provider | interim FND-02 stand-in |
| ✅ | Authenticated group senders (leaf credential must match server-reported source device) | |
| ✅ | Create group, encrypted group name, add/remove members (admin/owner), removed-member state | |
| ✅ | Linked-device sync: own devices added/removed in joined groups on DEVICE_LIST_CHANGED | |
| ✅ | Leave, invite links, join requests, bans (see below); promote/demote/transfer UI | GRP-03, EXT-03 |
| ⬜ | Credential binding to account identity key, reviewed role profile, pending-removal gate | GRP-01 |

## Delivery & verification

| Status | Item | Notes |
|---|---|---|
| ✅ | Root `docker-compose.yaml`: Postgres, Valkey, Keycloak (realm import), SeaweedFS, server, web | |
| ✅ | Playwright e2e (Chromium + Firefox), 38 spec files covering messaging, groups, communities, calls, media, privacy, notifications and admin | last full run 98 passed / 0 failed / 4 skipped (hostname-only passkey specs) |
| ✅ | Kubernetes: CI-published images (`convo-server`, `convo-web`, `convo-keycloak`), homelab Helm charts (own Keycloak for same-origin passkeys; shared Postgres/Redis/MinIO/ntfy; LiveKit + coturn) | `deploy/k8s.md`; charts lint/render, web image verified in ingress mode |
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
| Communities: ack withdraw/custom reviewers, membership-operation retries/ownership transfer flow, polls/events | COM-01/02 |
| FCM fallback (Web Push done); kill-point/Valkey-loss drills for push | MSG-02 |
| Calls: screen sharing, invited-member call links | CALL-01 |
| First production deployment on the homelab cluster (charts ready; router UDP forwards + `turn.doncik.ro` for calls) | OPS |
| Admin: signed policies, aggregate health, platform/compliance roles | ADM-01 |
| Kyber/PQ prekeys (needs a libsignal with Kyber support), PQ MLS profile | FND-02, PQ-01 |

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

Since then: clickable links with redirect confirmation, richer conversation info/actions and the
native Android client (APK in `apps/assets`) are done. Old-origin migration and iOS remain open.
Historical implementation plans are in `docs/superpowers/plans`.
