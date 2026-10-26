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
| Android | `apps/android/app/src/test` (JUnit, JVM) | Kotlin helpers, translations | `cd apps/android && ./gradlew testDebugUnitTest` |
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

## Coverage

### Backend

JaCoCo measures two things and merges them:

1. the JUnit suite (`./gradlew test` writes `build/reports/jacoco/test`);
2. the **running server** while the API, e2e and load suites drive it: the dev server runs the
   locally built jar with the JaCoCo agent attached.

```sh
cd server && ./gradlew test coverageServer && cd ..
docker compose -f docker-compose.yaml -f docker-compose.coverage.yaml up -d server
docker compose --profile e2e run --rm api-tests          # and/or the e2e suite
docker compose -f docker-compose.yaml -f docker-compose.coverage.yaml stop server   # flushes coverage
(cd server && ./gradlew jacocoCombinedReport)            # build/reports/jacoco/combined/html
docker compose up -d server                              # back to the normal image
```

### Clients

`npx vitest run --coverage` in `apps/web` and `apps/admin` (V8 provider; reports in `coverage/`).

## Load, scalability and chaos

* **Locust** (`tests/api/locustfile.py`): 1,000 simulated users, each with an enrolled device and an
  open WebSocket, sending to contacts, receiving and acknowledging, reading their state. Pass/fail
  thresholds (error rate, p95 latency) are asserted at the end of the run.
* **Two replicas**: `docker-compose.scale.yaml` runs two backend instances behind the web proxy;
  delivery across instances (WebSocket hints through Valkey) is part of the load scenario.
* **Chaos**: during load, one replica, Valkey or PostgreSQL is stopped and restarted; no message
  may be lost or delivered twice, and clients must recover without intervention.

## Progress

Tracked in `tasks.md` (TEST-*). Every bug found by these suites gets a regression test in the layer
that would have caught it first.
