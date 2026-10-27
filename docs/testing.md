# Testing

Convo is tested at every layer, against the real running stack wherever possible. The goal is
**3,000–4,000 tests of all kinds and no known bugs**: every failure found is fixed (or recorded in
`tasks.md` with an owner) before a release.

Count the suites at any time (numbers come from the test runners, not from grepping):

```sh
scripts/count-tests.py            # all suites (Docker needed for the API and e2e collectors)
scripts/count-tests.py --no-docker
```

## Layers

| Layer | Where | Runs against | Command |
|---|---|---|---|
| Backend unit | `server/src/test` (JUnit 5, Mockito, ArchUnit, Spring Modulith) | classes in isolation; module boundaries | `cd server && ./gradlew test` |
| Shared vectors | `contracts/vectors` (device auth, key transparency) | Java and TypeScript against an independent Python generator | part of the unit suites |
| Web core and UI | `apps/web/src/**/*.test.ts(x)` (Vitest) | encryption core, stores, reducers, components | `cd apps/web && npx vitest run` |
| Admin console | `apps/admin/src/**/*.test.ts(x)` (Vitest) | console logic and components | `cd apps/admin && npx vitest run` |
| Android | `apps/android/app/src/test` (JUnit, Robolectric, Compose UI test; JVM) and `src/androidTest` (on device) | Kotlin helpers, translations, whole screens against a fake core | `cd apps/android && ./gradlew testQaUnitTest` |
| API contract, security, robustness | `tests/api` (pytest, Python device client) | the running Compose stack, real devices and signatures | `docker compose --profile e2e run --rm api-tests` |
| End-to-end | `tests/e2e/tests` (Playwright, Chromium + Firefox) | the running stack through real browsers | `docker compose --profile e2e run --rm e2e` |
| Android end-to-end | `tests/e2e/android` | the emulator driven by adb plus a browser peer | see `tests/e2e/android/*.sh` |
| Production smoke | `tests/e2e/smoke` | the deployed site after every release | see `deploy/k8s.md` |
| Load and performance | `tests/api/locustfile.py` (Locust) | the running stack, 1,000 simulated users | see below |
| Scalability and chaos | `tests/api/chaos` | two backend replicas, killed and restarted during load | see below |

### API suites (`tests/api`)

`convo_client` enrolls real devices (P-256 request-signing key, Curve25519 identity key) and signs
every request exactly like the apps (`ENCLAVE-REQ-V2`, single-use server nonces), and speaks the
WebSocket mailbox protocol. Payloads are opaque random bytes — the server only ever sees ciphertext,
so its behaviour is identical. Users come from Keycloak's admin API and a **test-only** password
client (`convo-api-tests`) that the suite creates in the development stack; it never exists in the
realm import or in production.

`scripts/gen-endpoints.py` regenerates `tests/api/endpoints.json` from the Spring controllers, so
every new endpoint is automatically covered by:

* `test_security_auth.py` — missing, forged, other-device and tampered signatures (body, path,
  method), signature lifetime, single-use nonces and request IDs, revoked devices, bad Keycloak
  tokens on account routes, and every admin endpoint against no token, ordinary members and device
  signatures (OWASP ASVS V2–V4);
* `test_robustness.py` — hostile bodies, path values and query strings on every endpoint; any 5xx
  is a bug (ASVS V5).

### Android screens on the JVM

`MainActivity` talks to the shared encryption core through `CoreTransport` (production:
`ProtocolBridge`, the core in a headless WebView). Tests install `FakeCore` before the activity
starts: it answers commands from per-test handlers, records every command, and emits the core's
events (`phase`, `snapshot`, …), so whole screens run under Robolectric without a WebView or server.
`Snapshots` builds snapshot JSON shaped like the core's. Known limit: under Robolectric a text field inside
a dialog window never reaches idle (Compose test rule times out), so dialogs with inputs are
asserted up to opening them and covered end to end on the emulator (`tests/e2e/android`). Assert on **what the UI asks the core to
do** (the recorded commands and their arguments), which is the contract the e2e suites then check
end to end. `src/test/resources/robolectric.properties` fixes the SDK and a phone-sized screen.

## Coverage

### Backend

JaCoCo measures two things and merges them:

1. the JUnit suite (`./gradlew test` writes `build/reports/jacoco/test`);
2. the **running server** while the API, e2e and load suites drive it: the dev server runs the
   locally built jar with the JaCoCo agent attached.

```sh
cd server && ./gradlew test coverageServer && cd ..
docker compose -f docker-compose.yaml -f docker-compose.coverage.yaml up -d server
docker compose -f docker-compose.yaml -f docker-compose.coverage.yaml --profile e2e run --rm api-tests   # and/or e2e
docker compose -f docker-compose.yaml -f docker-compose.coverage.yaml stop server   # flushes coverage
(cd server && ./gradlew jacocoCombinedReport)            # build/reports/jacoco/combined/html
docker compose up -d server                              # back to the normal image
```

Pass **both** compose files to every command in the run, including `run`: a `run` with only
`docker-compose.yaml` recreates `server` (and `web`) from the plain configuration, silently
dropping the agent and the instrumented web build. Check with
`docker inspect enclave-server-1 --format '{{.Config.Env}}' | grep -c jacoco` (1 = agent attached).

### Clients

* Unit: `npx vitest run --coverage` in `apps/web` and `apps/admin` (V8 provider; reports in
  `coverage/`).
* Web end to end: the coverage override builds an Istanbul-instrumented web app
  (`COVERAGE=1`); with `COVERAGE_DIR` set the e2e support saves each page's `window.__coverage__`.
  `npm run coverage:merged` (in `apps/web`) runs Vitest with the Istanbul provider and merges it
  with the e2e files into `apps/web/coverage-merged/`. The e2e build is instrumented after
  transpilation, so its coverage is first mapped back to source lines through the embedded source
  maps; merging without that step double-counts lines.
* Android: tests run against the `qa` build type (debug without minification, so the test seams
  keep their names). `./gradlew testQaUnitTest connectedQaAndroidTest mergedCoverageReport` merges
  JVM and on-device coverage into `app/build/reports/jacoco/mergedCoverageReport`; without a device
  it reports the JVM tests. On-device tests (`src/androidTest`, sharing `FakeCore` from
  `src/sharedTest`) cover what Robolectric cannot drive: dialogs with text fields, media, audio.
  Run them on a dedicated emulator: `connectedAndroidTest` reinstalls and then uninstalls the app,
  which would wipe a signed-in development install.

## Load, scalability and chaos

* **Locust** (`tests/api/locustfile.py`): 1,000 simulated users, each with an enrolled device and an
  open WebSocket, sending to contacts, receiving and acknowledging, reading their state. Pass/fail
  thresholds (error rate, p95 latency) are asserted at the end of the run.
* **Two replicas**: `docker-compose.scale.yaml` runs two backend instances behind the web proxy;
  delivery across instances (WebSocket hints through Valkey) is part of the load scenario.
* **Chaos**: during load, one replica, Valkey or PostgreSQL is stopped and restarted; no message
  may be lost or delivered twice, and clients must recover without intervention.

## Progress

Coverage on 2026-10-27 (lines; backend = JUnit + API + e2e against the instrumented server; web =
Vitest + instrumented e2e, merged):

| App | Lines | Branches | Tests |
|---|---|---|---|
| Backend | 92.9% | 76.9% | 176 JUnit, 2,212 API, 119 e2e |
| Android (JVM) | 69.2% | 36.4% | 1,073 |
| Web | 84.7% (merged) | 68.6% | 421 Vitest + e2e |
| Admin console | 18.3% (unit) | 10.1% | 157 Vitest + e2e |

Admin API step-up checks need `auth_time`, which password grants do not carry: the functional
admin suite (`test_admin_api.py`) signs in through the login form with the test-only client
(`Keycloak.user_token_interactive`).

Tracked in `tasks.md` (TEST-*). Every bug found by these suites gets a regression test in the layer
that would have caught it first.
