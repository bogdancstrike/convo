# Convo security and parity implementation plan

> Execute sequentially with reviewable checkpoints; no parallel agent work is required.

Goal: Finish the requested web/Android parity and authentication/privacy features without weakening
E2EE or losing existing account data. Existing master checkpoint: 89ef009.

## Preserve established behavior

- Keep existing native installs on their stored/legacy IP IndexedDB origin; use the new hostname
  for new installs. Changing the origin must never silently hide/replace enrollment keys.
- Keep the canonical historical account issuer and stable Keycloak subjects. New browser origins
  use trusted-device linking or the existing recovery code; never merge accounts by username.
- Continue periodic APK refresh, Docker Compose FE/BE deployment, browser E2E and adb checks.

## Current changes awaiting the next checkpoint

- [x] Shared native/web semantic palettes, logo and core interoperability.
- [x] Native global Media browser, shared filtering/selection operations, requested footer order
  Chats / Channels / Unread / Calls / Profile, toolbar Media, Settings All Media, draft persistence.
- [x] Native explicit success feedback for saved status, photo update/removal and status removal.
- [x] One backend attachment policy (`CONVO_ATTACHMENT_MAX_MB=100`), runtime client policy and
  encrypted-size allowance for authenticated tags/size buckets; boundary tests pass.
- [x] Byte-compatible display fingerprint using pinned Noble SHA-512 instead of the old library's
  timer-per-digest loop. 5200-round compatibility test passes; failing Firefox UX test now passes.
- [x] Local /etc/hosts maps convo.doncea.ro to 192.168.1.144. TLS SAN now includes hostname/IP;
  Keycloak passkey RP ID is convo.doncea.ro. New certificate copied into debug APK trust resource.
- [x] Keycloak responsive theme built on stock keycloak.v2 forms; larger controls, Convo branding,
  light/dark colors, mandatory phone input uses a telephone keyboard.
- [x] Finish hostname browser suite, native gallery/save/restart checks and commit/push updated APK.

## Edit policy (implemented 2026-10-20, see ADR-0005)

Implemented with server envelope timestamps instead of edit grants/commitments; the remaining
bullets below are the original design notes. Done: windows, revisions, per-revision receipts,
re-read receipts, archive merge, preview update, web + Android UI and unit/E2E tests.


- Chats/groups/notes: own text only, 15 minutes; being read does not prevent editing. Channel
  text updates: 30 days, existing author-only security rule retained. No media rewriting.
- Edited label, no visible edit history/new chat notification. Reset receipts per content revision;
  old delivery/read receipts or older archive entries cannot mark the new revision seen.
- Add backend opaque edit windows and grants, not plaintext processing. The original encrypted
  message binds its immutable window ID. Register the window in the durable outbox before first
  encryption, using server time. Author+message ID registration is idempotent and cannot extend it.
- A timely grant binds target/window/author/revision to a SHA-256 commitment of random secret
  salt plus new text; salt travels only in E2EE content, preventing server dictionary attacks.
  This prevents obtaining a grant before expiry then swapping arbitrary text after expiry.
- Receivers validate grants/binding, text eligibility and increasing revision; offline network
  validation failure must leave the envelope unacknowledged and protocol state uncommitted.
- Read/delivery acknowledgements identify revisions. Mark-read considers edited unread messages,
  not only the newest N original timestamps. Archive merge chooses the newest content revision
  and only merges receipts belonging to that revision.
- Test exact time boundary, edits after seen, unchanged/empty/oversize text, media rejection,
  ownership, direct/group/channel, stale grants, replay, out-of-order edits/receipts, archive merge,
  multiple devices, offline retry and native/web editing.

## Media preferences (implemented 2026-10-20)

Done: shared `mediaPolicy.ts` (device-local per-network rules, own media always shown, 16 MiB
prefetch cap), web Storage and data page, Android per-network checkboxes, network detection and
MediaStore Save to gallery (Android 10+, once per attachment). Locked-chat exclusion follows the
conversation-lock work.


- All Media Settings row on both clients opens the same gallery (implemented, verification pending).
- Add image/video auto-download controls; phone Wi-Fi/mobile/roaming controls plus an independent
  Save to gallery switch. Browser downloads remain explicit file saves; automatic preview fetch
  does not silently write into the user's Downloads directory.
- Store automatically fetched files encrypted/private. Only the separate gallery opt-in exports
  plaintext via Android MediaStore. Explain that other apps with gallery access can read copies.
- Exclude locked conversations from auto-saving and global search/media until authenticated.

## Passkeys, app lock, conversation lock (implemented 2026-10-21)

Done: read-only credential-status service account and endpoint, web/Android Manage passkeys,
Android BiometricPrompt app lock and chat locks with list/search/media/gallery exclusion.
Web chat locks use passkey user verification (2026-10-21). Remaining: web app-wide screen lock,
physical-device biometric checks.


- Keycloak owns passwordless enrollment; Android owns fingerprint/device PIN. Never obtain/store
  biometric templates or a device PIN in Keycloak/Convo. System-browser SSO remains in AppAuth.
- Add Manage passkeys in Settings after login, opening trusted Keycloak Account Console.
- Backend checks the current account's registered credential types using a read-only realm service
  account (view-users only; no administrator role). Keep its secret in ignored .env, never APK/Git.
  Status errors are unavailable, not a fabricated successful/false enrollment.
- Enable native locks only after confirmed passwordless enrollment, as requested. Existing locks
  continue to protect locally while offline; removing an IdP passkey must not silently disable them.
- Use AndroidX BiometricPrompt and device-credential fallback. Cancel/failed authentication leaves
  the app/chat locked. Hide content before foreground rendering; clear unlock grants on background.
- Per-chat menu lock/unlock requires system authentication. Hide locked titles/previews/photos in
  ordinary lists, omit contents from search/global galleries, and never auto-export locked media.
  Nested info/media navigation must preserve a legitimate current unlock until leaving the chat.
- Test enabling without passkey, enrollment cancellation, status unavailable, OS PIN not configured,
  successful/failed/cancelled biometric/PIN, process death/background, no first-frame content flash,
  search/media/direct-navigation bypasses and disabling/removing protections.

## Documentation and remaining parity

- Keep README, docs/tasks.md, root tasks.md, specs §32, mobile/architecture/configuration and ADRs
  aligned with actual test evidence; don't close broad launch/security gates on prototype evidence.
- Remaining older work: full localization, voice recorder UI, cross-message viewer navigation,
  physical-device/accessibility testing, legacy HTTP-origin/old-IdP-subject recovery/migration.
- Native reviewed Rust/SQLCipher/Keystore core and background delivery remain explicit release
  gates; iOS has not been implemented. Calls remain the requested future placeholder.
