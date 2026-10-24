# Convo Android development client

Native Kotlin/Compose presentation. The development protocol adapter reuses the bundled,
version-pinned web encryption core; it never loads the remote web UI or remote JavaScript.
This is an interim interoperability client, not the reviewed native Rust/SQLCipher client
required by `docs/mobile.md` for production certification.

Default server for new installs: `https://convo.doncik.ro` (the homelab deployment, publicly
trusted certificate via Cloudflare). Another server can be entered on the sign-in screen. Existing
installs retain their saved origin to preserve device-local encryption keys. Release builds use ordinary platform TLS trust.
Debug builds additionally trust only the exact development certificate shipped in debug
resources, and only for the configured development host. No global trust-all manager.
Android backup is disabled. The development build uses the browser engine's encrypted
transactional record store in app-private storage; this is not yet SQLCipher/Keystore wrapping.

Phone contacts require Android READ_CONTACTS permission and an explicit discovery action.
Names/photos from the phone never go to the server. Permission denial retains manual search.
A directory phone claim does not prove phone ownership; use contact safety verification.

Build with JDK 17 and an installed Android SDK (platform 34):

```sh
ANDROID_HOME=/path/to/Android/Sdk JAVA_HOME=/path/to/jdk-17 apps/android/scripts/build-apk.sh
adb install -r apps/assets/convo-android-debug.apk
```

Full steps (SDK setup, checksum, installing, using the local Compose stack from the emulator)
are in the root README under *Build the APK*.

The script type-checks and bundles the shared protocol adapter, generates native color tokens
from the web palette, builds the APK and writes its checksum into apps/assets.
Both light and dark modes use those shared semantic colors. Compose Material 3 supplies native
accessible controls, themed through ConvoTheme and reusable presentation components. The
launcher uses the same logo paths and gradient as the web application.

Interoperability evidence: emulator-5554 signs in through Keycloak/PKCE, receives and decrypts
a browser message, sends a message that the browser decrypts, receives an encrypted image and
document, and retains both message directions after APK replacement and process restart.
No account credentials are included in the source or APK. The debug certificate is public.

Full web/Android parity is the acceptance target, **not the current completion status**.
The native global media browser now supports filtering and batch actions, Settings includes All
Media, drafts persist locally, profile changes show success feedback, Storage and data offers
per-network media auto-download and an opt-in Save to gallery (MediaStore, Android 10+), and Edit
follows the shared 15-minute / 30-day channel window. Privacy shows passkey status and offers an
app lock and per-chat locks (BiometricPrompt with screen-lock fallback) once a passkey exists. Voice notes are recorded natively (Opus/OGG). Voice/video calls use the LiveKit Android SDK with
frame E2EE (ADR-0006); APK native libraries are limited to arm64-v8a and x86_64. The UI follows the EN/RO language setting (`I18n.kt`). Remaining gaps include exhaustive
visual/accessibility/device testing. iOS has not been implemented. Native background delivery,
Keystore wrapping and the reviewed Rust/SQLCipher core remain separate security/release gates.

## Background notifications (UnifiedPush)

Install a UnifiedPush distributor such as [ntfy](https://ntfy.sh) and set its default server to
the organization's ntfy (homelab deployment: `https://ntfy.doncik.ro`, signed in with an account
that can read `up*` topics; Compose: `http://<server>:8091`). Convo registers automatically when it
signs in; when it is not running, a message produces a generic "New message" notification
(content stays end-to-end encrypted until you open the app).

**How messages reach a closed or backgrounded app.** Convo does not use Google's push service, so:

| Phone setup | While Convo is open | Backgrounded / closed |
|---|---|---|
| ntfy installed, default server = the organization's | live connection | ~15 s after leaving the screen the app hands over to push; each new message wakes it and shows "New message" |
| "Stay connected in the background" on | live connection | live connection kept by a foreground service (ongoing notification, more battery) |
| neither | live connection | **nothing arrives until you open Convo** — messages wait encrypted in the server mailbox and are never lost |

The third row is expected, not a bug: without a push channel Android freezes a backgrounded app
within about a minute. Settings → Notifications → *Background delivery* shows which case applies
and how to fix it. On first start after sign-in Convo asks once for notification permission and
turns notifications on if granted (previews stay hidden by default).

Testing locally with the emulator: `adb reverse tcp:8091 tcp:8091`, set ntfy's default server to
`http://localhost:8091` (allowed by the dev Compose), then go home and send a message from the web.

## Source layout

Packages mirror the web client (`apps/web/src/ui`):

| Package | Web counterpart | Contents |
|---|---|---|
| `app` | `ui/App.tsx`, `MainLayout` | `ConvoTheme`, navigation shell (top bar, bottom bar, FAB, routes) |
| `bridge` | `core/` | `ProtocolBridge` (headless WebView running the bundled core), dev TLS |
| `ui.chats` | `ChatListPanel`, `conversationMenu` | chat list and rows, chat ⋮ / long-press menu, snooze |
| `ui.thread` | `Thread`, `MessageBubble`, `Composer` | conversation, bubbles, composer, voice notes, acknowledgements |
| `ui.info` | `ConversationDetails`, `ContactDrawer` | contact/group/channel info, members, invites |
| `ui.contacts` | `NewChatPanel`, `NewGroupPanel` | people picker, phone contacts, group/channel wizard |
| `ui.communities` | `CommunitiesPanel` | communities |
| `ui.settings` | `SettingsPanel`, `ProfileSettings` | settings pages |
| `ui.media` | `AllMedia`, `SharedContent` | media browser and tiles |
| `ui.locks`, `ui.linking` | `chatLocks`, `LinkDeviceScreen` | app/chat locks, device-link QR |
| `ui.components` | `components/` | avatar, rows, sections, empty states, buttons |
| `ui.theme` | `theme/tokens.ts` | generated `DesignTokens.kt` (do not edit) |
| `calls`, `push`, `i18n` | `calls/`, `notifications`, `i18n/` | LiveKit calls, UnifiedPush and notifications, EN/RO strings |

## Look and feel

The layout follows WhatsApp for Android (bottom tabs, FAB, long-press menus, info pages with
sections) in Convo's web style (same tokens, wallpaper, bubbles, encryption pill, chips). Colours
come only from `LocalConvoColors`; never hard-code a colour in a screen. Shared pieces live in
`ui.components` (`EmptyState`, `InfoSection`, `ActionRow`, `QuickAction`, `CircleAction`,
`RoundActionButton`, `PersonAvatar`) and `ui.chats` (`SearchField`, `PillChip`, `Tag`).
