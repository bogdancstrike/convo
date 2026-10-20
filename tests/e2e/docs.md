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
* `tests/linking.spec.ts` — ID-02: second browser links with matching comparison codes, then
  fan-out reaches both devices and sent messages mirror across own devices.

Artifacts (traces, screenshots, HTML report) are written to `tests/e2e/test-results/`.
