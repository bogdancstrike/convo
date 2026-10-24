# Convo — Mobile architecture and delivery

| Field | Value |
|---|---|
| Status | Draft v1.3, 2026-10-17 |
| Current focus | Android alongside the P0 web client |
| Client follow-on | iOS after Android/web stabilization; every Android/web feature is launch-required |
| Related | [UI](UI.md), [Specs](specs.md), [ARF](arf.md), [Tasks](tasks.md), [Sources](sources.md) |

## Running Android development checkpoint

`apps/android` now contains a Kotlin/Compose native presentation client and
`apps/assets/convo-android-debug.apk` is the installable development artifact. It uses the
Kotlin alternative below with an explicitly interim bundled headless browser protocol adapter;
it does not implement the proposed Rust/SQLCipher core or claim production certification.
Android↔web decryption, process restart/APK replacement and linked-browser history restore have
been verified on emulator-5554. The optional native foreground WebSocket fallback from §5 exists ("Stay connected in the
background"). See [the current client README](../apps/android/README.md) for
build commands and remaining parity/security work. Planned launch requirements below still apply.

## 1. Release scope

P0 Android includes organization bootstrap, SSO, first-device registration, browser/device linking, 1v1/group/community messaging, add/remove/promote/demote and join approval, admin-only announcements with explicit acknowledgements, community welcome/rules/checklists and eligible group recommendations, shared pins and bounded batch forwarding/copy/save/delete, rich descriptions and private chat themes, member search/groups in common, encrypted files/photo albums/voice notes, mentions-only and snooze notifications, unread catch-up and fast accessible actions, local search, own-device sync, identity verification, disappearing messages, direct audio/video calls, privacy settings, app lock, and reliable recovery from process death. It works against on-prem services in connected and restricted profiles, with explicitly certified notification behavior.

The web client is a peer P0 product, with its own UI and browser platform adapters. Android must link and exchange messages/calls with web throughout development; a mobile-only prototype is insufficient for P0 acceptance. Every advertised feature, including encrypted history transfer and group media/screen sharing, is an Android/web launch gate. iOS and ReplayKit remain a separate client workstream; this does not defer any Android/web feature.

## 2. Framework decision and evaluation

Baseline: **Flutter for Android**, native Kotlin adapters, and shared Rust protocol/storage logic. Future iOS uses Flutter plus Swift adapters and extension targets. Web uses React/TypeScript plus browser-compatible Rust/WASM adapters. This follows [ADR-021](arf.md#adr-021-android-and-web-first-flutter-android-and-react-web).

Kotlin Multiplatform is a viable alternative for shared mobile logic/UI. Current official documentation marks Android/iOS KMP and Compose Multiplatform stable; reject the old argument that iOS support is inherently experimental. Browser UI support and protocol dependencies still require their own evaluation. [Official platform matrix](https://kotlinlang.org/docs/multiplatform/supported-platforms.html).

| Criterion | Flutter + Rust baseline | KMP + Rust alternative | Proof required |
|---|---|---|---|
| Android delivery | Shared Dart UI/domain presentation with native adapters | Kotlin shared logic + Compose Android UI | Compose/send/group/local search and native lifecycle smoke test |
| Future iOS | Shared Flutter UI; Swift extensions separate | Shared logic/Compose UI or SwiftUI facade; Swift extensions separate | No full app runtime in notification/local-push extension |
| Protocol implementation | Generated Flutter/Rust FFI; native core owns transactions | JNI/C ABI/UniFFI or reviewed bindings; same Rust protocol core | Same vectors/state transitions and crash recovery |
| Background/calls | Kotlin foreground/notification/Telecom plugins | Native Kotlin APIs with shared state bridge | Locked/process-killed incoming call and no double ringing |
| Browser pairing | React web plus WASM worker | Same independent React web choice | Cross-client decrypt, role validation, and sync |
| Team/maintenance | Dart + Kotlin + Rust; Swift later | Kotlin + Rust; Swift later | Named ownership, build/signing/release maintenance capacity |
| Performance/accessibility | Measure startup, memory, TalkBack, large text | Measure same workloads | Evidence beats framework marketing or old maturity claims |

Do not implement both mobile frameworks. FND-02 records the final pinned toolchain and bridge strategy. A framework change must not change wire formats, identity semantics, or weaken web encryption. No requirement assumes libsignal has a supported browser binding; browser viability is the highest-priority cross-platform spike.

## 3. Proposed Android code boundaries

```text
apps/enclave_app/
  lib/app/                  # navigation, lifecycle state, dependency wiring
  lib/features/onboarding/  # organization, SSO, device link/reset UI
  lib/features/chats/       # lists, thread, composer, attachments
  lib/features/communities/  # announcement feed, linked groups, roles/removal progress
  lib/features/calls/       # call UI fed by shared call state
  lib/features/settings/    # privacy, devices, storage, diagnostics
  lib/platform/             # narrow native plugin contracts
apps/android_native/
  keystore/                 # key wrapping, biometric policy, key invalidation
  notifications/            # channels, actions, local dedupe
  delivery/                 # distributor registration / approved socket service
  calls/                    # Telecom, audio focus/routes, lifecycle
  files/                    # pick/share/cache cleanup
core/enclave-core/          # public typed facade, protocol orchestration
core/enclave-store/         # native encrypted transactions/migrations
core/enclave-direct/        # pinned libsignal adapter
core/enclave-group/         # pinned OpenMLS + group application profile
core/enclave-browser/       # web worker facade, encrypted browser store adapter
```

These directories are planned artifacts, not existing implementation. Presentation does not read raw protocol tables or call crypto primitives. The core emits typed state/events and accepts typed commands; no private keys in widget state, Kotlin logs, Dart exceptions, or diagnostic payloads. FFI byte buffers have explicit lifetime/zeroization rules, and bounded parsing precedes expensive work. Native keystore/OS/media functions stay behind small interfaces.

Core operations include `register_device`, `approve_link`, `queue_message`, `process_envelope`, `apply_group_event`, `verify_identity`, `revoke_device`, `lock`, `unlock`, `expire_local_content`, and typed call actions. Concrete signatures are generated from the agreed schema, not copied from illustrative draft snippets. FFI failures use a stable sanitized error code plus recoverable state; do not leak key material in debug strings.

## 4. Android identity, local storage, and lock

Keycloak sign-in runs in the system authentication browser with PKCE and supports user-chosen WebAuthn/passwordless plus Google Authenticator-compatible TOTP 2FA at launch. Security settings open the trusted Keycloak Account Console/required action for enrollment, recovery and changes; OTP secrets never traverse the Flutter/Rust chat core. Certify local hardware/platform authenticators without cloud requirements in restricted profiles. Passwordless-plus-TOTP, cancellation, stale SSO, unavailable authenticators and required step-up are physical-device cases (AC-ID-01–05). IdP recovery and local biometric unlock cannot replace trusted-device encryption provisioning.


Generate account/protocol keys locally using a certified CSPRNG. Protect a random SQLCipher DB key with Android Keystore wrapping keys; request hardware backing/StrongBox when available and record only coarse capability status. Signal/MLS private keys generally live encrypted in the local DB because the protocol library needs them; do not claim all protocol operations execute inside StrongBox.

Exclude messages, protocol state, attachments, keys, and credentials from Android backup/device-transfer defaults. Reinstall/keystore invalidation is a fresh device enrollment, not a silent restoration of old ratchet state. A passcode/biometric lock must define how background decryption works: a key requiring user auth for every use cannot also decrypt locked-screen content unattended. Hardened mode stays generic while locked; foreground unlock is required for content.

Use a single transactional writer for protocol state across UI/native background workers. The decrypt → new state → plaintext/index → processed ID transaction precedes server ack. On outgoing send, persist ratchet advancement and ciphertext before transmission. Process death at any instruction must recover without nonce/key reuse, duplicate visible messages, or premature delivery acknowledgement.

At app lock, clear visible content and memory keys where practicable, redact app-switcher previews, and expire allowed notification text. `FLAG_SECURE` may reduce screenshots/screen capture under policy; it cannot prevent cameras, a compromised OS, or all accessibility extraction. Wipe is key destruction plus best-effort cache/storage cleanup, not guaranteed flash erasure.

## 5. Android background delivery

| Mode | Fit | Constraints and UI |
|---|---|---|
| UnifiedPush + certified ntfy distributor | Default on-prem option | Distributor installation/registration and LAN/VPN reachability must be provisioned and tested; show actual state. |
| FCM data wake | Optional connected deployments | Allowlisted Google egress and user notification permission; generic payloads, no content keys or identity. |
| Native foreground WebSocket service | Restricted fallback where policy permits | Visible persistent notification, correct service type/start rules, measured battery cost; not a bypass for background restrictions. |
| App foreground only | Explicit degraded mode | Queue remains durable; explain delayed notifications/calls until app opens. |

Implemented behavior (UnifiedPush): with a registered, accepted endpoint the app closes its socket
15 s after leaving the screen (not during a call; not with the foreground-service option), so the
server sends content-free wakes instead of writing to a socket the OS freezes about a minute later.
If a socket dies without a clean close (killed process, lost network), the server wakes the device
for any undelivered mail once its last session closes (idle timeout, default 90 s). Without a
distributor or the foreground service, delivery waits until the app is opened (degraded mode
above); the in-app Background delivery card says so.

Android manufacturer restrictions, Doze, app standby, force-stop, restricted battery mode, and notification permission affect delivery. WorkManager performs deferred retry/cleanup/key replenishment; it is not a precise scheduler for ringing or guaranteed real-time message delivery. A foreground service may be stopped/restricted; test it under supported OS and distribution rules. [Android background restrictions](https://developer.android.com/develop/background-work/background-tasks/bg-work-restrictions).

Register/rotate push endpoint generation transactionally. The app acknowledges locally rendered notification event IDs and deduplicates repeated provider wakes. Fetch a bounded mailbox batch, process safely, and hand off remaining work without exhausting the background budget. Background failure leaves content recoverable in the mailbox; it must not falsely acknowledge or replace message content with an error.

Provide separate Android channels for messages, calls, and security notices. Respect user/OS channel settings, Do Not Disturb, and notification permission. Generic preview is default. Mentions-only alerts require local verified structured mentions; when lock policy prevents decryption, defer them. Snooze suppresses ordinary alerts until a synced deadline then restores the underlying mode, with expiry checked on resume/delivery and no exact background timer or backlog-alert promise. Quick reply is disabled while app lock prevents safe access; authentication/lock policy applies to notification actions too. A notification tap targets an opaque local conversation reference and does not place content into a URI.

## 6. Android direct calls

Use native Android Telecom/ConnectionService or the certified current Telecom integration for system call coexistence, audio focus, routing, Bluetooth, and lock-screen interactions. Select the exact API after the supported-OS spike; framework plugin claims alone are insufficient. Foreground services declare the appropriate microphone/camera/call capabilities under current target-SDK rules.

Signal-encrypted offers/answers/ICE bind caller, device, call instance, generation, and deadline. Reject unverified identity changes before starting media. The first accepted answer wins; all other devices close their incoming state. Process-killed/background/foreground paths share the same persisted ended-call marker, so a delayed push cannot resurrect a call. Do not automatically answer glare or open a microphone merely because the server delivered an urgent event.

Test Wi-Fi/cellular/VPN handover with ICE restart, TURN UDP/TCP/TLS fallback, headset disconnect, another phone call, audio-focus loss, camera denial/revocation, and process interruption. Keep native call state and UI state consistent after navigation or app restart. Launch group calls require a tested SDK E2EE provider, participant binding, removal-triggered media pause, and key-slot wrap tests before any media is published.

## 7. Media, permissions, and resource use

Request notifications after onboarding context, camera for scanning/video, microphone for voice notes/calls, and system media/file picker access at attachment selection. No broad contacts, location, call-log, SMS, or all-files permission is needed for core messaging. Explain denial without blocking text chat; support later settings recovery without looping prompts.

Encrypt attachments into private cache incrementally, with a bounded memory working set. Deduplicate upload retries by stored ciphertext; do not re-encrypt changed plaintext under a reused nonce. Handle low disk, cancelled selection, large images, hostile archive/image inputs, MIME mismatch, and content-provider streams that become unreadable. Plaintext external sharing is explicit and policy-bound; revoke temporary file grants and clean cache on deadline.

Voice notes support local playback speed, waveform from decrypted local data, interruption handling, and accessible progress. No cloud transcription in P0. Download over metered networks follows user/org preference; thumbnails remain encrypted and are deleted with the parent message. Battery/network budgets are benchmark targets from real devices, not framework assumptions.

## 8. Android and web compatibility

| Scenario | Required parity |
|---|---|
| Android creates account, web links (or browser primary, Android links) | Explicit QR consent; shared identity, separate sessions and MLS leaves; no old history promise. |
| Web sends while Android sleeps | Durable backend intent; certified wake path; receipt only after core persistence. |
| Both send/react/edit concurrently | Idempotent message mutations and deterministic own-device preference convergence. |
| Android revokes web | Subsequent server calls denied, socket closed within bound, group removal initiated; web local erasure attempted. |
| Web storage is cleared | Explicit lost-device state and re-link, never reuse partially restored protocol state. |
| Community announcement/member-removal across Android/web | Admin-only posts, independent subgroup keys/roles, private discovery, pending cross-group removal and explicit completion. |
| Both enter same group during concurrent commits | Authorized device joins and sequenced catch-up; no duplicate leaf/rogue role. |
| Direct call rings both | One answer wins; no duplicate ringing after delayed push/reconnect. |
| Expiry/read settings change | Authenticated settings and earliest expiry-start propagation; independent notification cleanup. |

Native CA pinning and browser trust are intentionally different platform mechanisms. The same organization configuration describes endpoints, protocol versions, and policy; browsers rely on their installed CA trust. Web cannot import native KeyStore security claims or Android screenshot guarantees.

## 9. Distribution and updates

Support signed Android APK delivery through on-prem MDM/internal distribution first; optional Play distribution is a separate connected channel. Pin application ID, signing certificate lineage, package/version, SDK/NDK, Flutter, Rust, and dependencies in the BOM. Protect production signing keys outside ordinary CI jobs; separate test/staging signatures and backend trust roots. Publish SBOM, checksums, provenance, and corresponding source/license artifacts as required by the reviewed distribution model.

Target current distribution requirements at implementation/release time; do not freeze a stale target API in a long-lived specification. Initial minimum OS candidate is Android 12 (API 31), subject to customer fleet/security-support evidence and plugin compatibility. Certify arm64 physical devices and x86_64 emulators; add other ABIs only when required. No claim of all-OEM support without tests.

Updates test encrypted-DB migrations, backward protocol compatibility, process death mid-upgrade, certificate rollover, and retained offline drafts. Rollback must not reopen a schema or ratchet state incompatible with the older binary. A forced upgrade displays a trusted internal distribution path and preserves encrypted data until safe handling is possible.

## 10. Separate iOS client workstream

### 10.1 Reuse and native boundaries

Reuse the Flutter conversation UI where practical, Rust protocol/profile/storage logic, schemas, vectors, and design tokens. Add Swift adapters for Keychain, app lifecycle, file/photo pickers, AVAudioSession, CallKit/PushKit, and app-switcher redaction. Native extensions run a minimal Rust/Swift runtime; they do not launch the Flutter engine to decrypt a notification.

SQLCipher lives in a private App Group container only where extension sharing is required. Keychain accessibility (`ThisDeviceOnly`, when-unlocked vs after-first-unlock) must match the chosen privacy/background behavior. Use a tested cross-process writer lock/lease and bounded fallback to generic notifications; memory/time limits are OS-controlled, not guaranteed fixed numbers.

### 10.2 Delivery profiles

Connected iOS uses APNs alert pushes with the required `aps` wrapper and `mutable-content`; NSE may fetch/decrypt when authorized and within budget. PushKit is for real incoming VoIP calls and must satisfy current CallKit reporting requirements, not general chat wakes. Private payloads contain no sender/body/group title. [Apple PushKit/CallKit guidance](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit).

Restricted iOS requires Local Push Connectivity (`NEAppPushProvider`) and Apple's app-push-provider entitlement, with configured matching SSIDs and a dedicated local bridge. MDM is the managed configuration/distribution route. Outside the supported network, restricted devices fall back to foreground delivery; do not promise unrestricted background messaging without APNs. [Apple Local Push Connectivity](https://developer.apple.com/documentation/networkextension/local-push-connectivity).

The iOS workstream starts with a signed physical-device entitlement/notification/call prototype. Signing/provisioning and initial distribution may require connectivity even if the eventual runtime deployment is air-gapped; document the operational boundary. Safari web certification is an Android/web launch gate and does not require completing the iOS app.

### 10.3 iOS completion gates

Validate fresh install, reboot before first unlock, locked app, NSE contention/timeout, APNs token changes, PushKit/CallKit acceptance, SSID transition/local push, revoked device, low memory, keychain invalidation, OS backup exclusion, VoiceOver, and signed upgrade. iOS ReplayKit screen-sharing needs a separate minimal publisher and E2EE key handoff review. No iOS work is required to declare Android/web P0 complete.

## 11. Mobile acceptance matrix

| Area | Android P0 evidence | iOS later evidence |
|---|---|---|
| Install and bootstrap | Managed private CA, organization selection, PKCE, signing | Managed trust/configuration, signed distribution |
| Storage integrity | Kill during decrypt/send, low disk, keystore invalidation, backup exclusion | App/extension concurrency, keychain accessibility, memory limits |
| Notifications | Foreground/background/Doze/force-stop/restricted battery, token rotation, denied permission | APNs/NSE/PushKit and local-push network matrix |
| Direct calls | Locked/process-killed incoming call, audio routes, ICE restart, expired offers | CallKit/AVAudioSession, system interruptions |
| Multi-device | Android↔web scenarios from §8 | iOS↔existing Android/web, without protocol fork |
| Accessibility | TalkBack, large font, keyboard, high contrast, RTL preparation | VoiceOver, Dynamic Type, native focus behavior |
| Security | No sensitive logs/backups, app lock behavior, revoked credentials, malformed media | Equivalent checks across main app and every extension |

Keep sanitized device/OS/build/network evidence for each supported profile. Synthetic tests cannot replace physical-device notification/call checks. [tasks.md](tasks.md) assigns Android work before iOS-specific tasks.


## 12. Complete Android feature release gate

Android ships the full specs §30.9 capability set, including group media/screen capture, collaboration and scheduling, optional backup/history import, local inference/model delivery, witnessed trust/PQ profiles, federation and visible integrations. Native adapters must cover capture/permissions, secure signing, background execution, local model resource budgets and offline stores. No feature is postponed because a cross-platform plugin or native bridge is missing. Specs §31 is the shared acceptance catalogue; physical-device results supplement, rather than replace, Android↔web interoperability evidence.
