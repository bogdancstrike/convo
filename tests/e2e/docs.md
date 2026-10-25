# `tests/e2e` — end-to-end suite

Playwright tests that drive real browsers against the full `docker-compose.yaml` stack
(nginx, backend, Keycloak, PostgreSQL, Valkey, SeaweedFS).

```bash
docker compose up -d --build
docker compose --profile e2e run --rm e2e          # Chromium + Firefox
# or locally: cd tests/e2e && npm ci && npx playwright install && npx playwright test
```

* `tests/support.ts` — creates throwaway Keycloak users via the admin API (each run starts with
  device-less accounts), drives SSO enrollment, chat helpers.
* `tests/messaging.spec.ts` — M1 walking slice: browser-primary registration, directory search,
  bidirectional E2EE messaging, delivery receipts, reactions, edits, delete-for-everyone, offline
  mailbox delivery after reconnect, Note to self.
* `tests/attachments.spec.ts` — FEAT-01: encrypted photo + file exchange (image renders, download is
  byte-identical) and proof that uploaded objects contain no plaintext.
* `tests/groups.spec.ts` — GRP-02/03: MLS group create, encrypted name, authenticated sender names,
  admin remove (removed member stops receiving) and add (new member gets name + new messages).
* `tests/linking.spec.ts` — ID-02: second browser links with matching comparison codes, then
  fan-out reaches both devices and sent messages mirror across own devices.

Artifacts (traces, screenshots, HTML report) are written to `tests/e2e/test-results/`.

## Android interoperability (`android/`)

`android/call-android.spec.ts` checks that web ↔ Android calls really work: a browser calls the
Android user, and for 5 minutes (configurable) both directions must keep carrying audio — with
decoded Android audio audible, via the debug build's opt-in test tone — and, with `VIDEO=1`, video
frames. `run-call.sh` builds the e2e image, accepts the call on the emulator and prints the
Android-side counters (logcat tag `ConvoCallStats`).

```bash
adb reverse tcp:8443 tcp:8443                      # emulator signed in as PK_USER on https://localhost:8443
PK_USER=droid tests/e2e/android/run-call.sh        # voice, 5 minutes
PK_USER=droid VIDEO=1 MINUTES=5 tests/e2e/android/run-call.sh
PK_USER=droid SHARE=1 tests/e2e/android/run-call.sh          # browser shares its screen
PK_USER=droid EXPECT_SCREEN=1 tests/e2e/android/run-call.sh  # tap "Share screen" on the phone
PK_USER=droid tests/e2e/android/run-call-link.sh             # Android joins via a member call link
```
