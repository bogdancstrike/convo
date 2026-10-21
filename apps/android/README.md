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
