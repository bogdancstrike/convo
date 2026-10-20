# Native Android implementation plan

Goal: Install a native Convo Android app against https://192.168.1.144:8443, reuse the existing encrypted account protocol without a wire fork, and validate Android↔web messaging on the running emulator. Keep web/mobile features and visual tokens aligned. Put the APK in apps/assets.

The mobile specification's shared Rust/Flutter core is not implemented in this repository. Use the documented Kotlin/Compose alternative for Android presentation, with a bundled headless browser protocol adapter as an explicitly interim feasibility bridge. The UI must be native Compose, not a website wrapper. Keep encryption keys and protocol state inside the adapter; expose only presentation models and commands. Replace this bridge with the reviewed native shared core before production certification. iOS follows Android and requires macOS signing/device verification.

- [ ] Create apps/android with pinned Gradle/Kotlin/Compose configuration, no telemetry, private storage/OS backup exclusions, native branding and theme tokens.
- [ ] Bundle an isolated TypeScript core entry from apps/web. No remote JavaScript or web UI. Native bridge commands cover sign-in/enrollment/link/recovery, conversations/messages/search, group/channel creation, encrypted media, profile/settings/device actions and history status.
- [ ] System-browser PKCE login through a separate Keycloak native client and an exact custom-scheme redirect; support cancellation and errors.
- [ ] Trust the specific development certificate only in debug builds. Keep release trust on system/organization CAs. Make server URL editable for later DNS migration.
- [ ] Native chat/channel/calls/settings navigation, thread/composer/message actions, info/gallery, profile/status/background controls and external-link confirmation.
- [ ] Build APK, install on emulator-5554 through adb, drive UI through adb/uiautomator, exchange encrypted messages and files with web, restart the process and verify history.
- [ ] Copy tested APK and SHA-256 checksum to apps/assets; document tested features and remaining native certification work honestly.

## Checkpoint evidence and parity acceptance

Native Kotlin/Compose client builds and runs on emulator-5554. System-browser PKCE enrollment,
Android↔web decryption, encrypted image/document reception, APK update and process restart
have been exercised. Both message directions survive without registering a new device.
The source and APK are included in Git. Shared light/dark semantic colors are generated from
web tokens; native launcher/in-app branding reuse the web logo. Material 3 provides native
controls, customized through shared tokens and reusable Convo components.

Full parity remains an open acceptance gate. Outstanding: global gallery batching/filtering,
voice-recording UI, draft persistence, full localization, cross-message media navigation,
visual/button/motion comparison at phone/tablet sizes, physical-device accessibility and
background-delivery certification. Do not label this checkpoint 100% parity or production-safe.
