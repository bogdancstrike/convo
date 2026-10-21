# Development guide

## Prerequisites

* Docker with Compose v2 (everything else runs in containers)
* For local iteration outside containers: JDK 21, Node.js 22+ (24 recommended)

## Run the whole stack

```bash
docker compose up -d --build        # postgres, valkey, keycloak, seaweedfs, server, web
open https://localhost:8443          # sign in as alice / alice-dev-password (also bob, carol)
docker compose logs -f server       # backend logs
docker compose down -v              # stop and delete all data
```

| URL | What |
|---|---|
| https://localhost:8443 | Web app (nginx; proxies `/v1` → server, `/auth` → Keycloak) |
| https://localhost:8443/admin | Convo organization admin console (realm role `convo-admin`) |
| https://localhost:8443/auth/admin | Keycloak admin (`admin` / `admin-dev-password`) |
| http://localhost:5050 | pgAdmin (database "Enclave (dev)" pre-registered; password `enclave-dev-db`) |
| localhost:5433 | PostgreSQL (`enclave` / `enclave-dev-db`) |
| `/rtc` (via nginx), UDP 50000-50100, TCP 7881 | LiveKit SFU for calls (media E2EE in clients) |
| UDP/TCP 3478, UDP 49160-49200 | coturn TURN relay |

All credentials above are development-only; override them via `.env` (see `.env.example`).

## Tests

```bash
# Backend: module boundaries + unit tests
cd server && ./gradlew test

# Web: unit tests (crypto, storage, codecs) and type-check
cd apps/web && npm ci && npm test && npm run typecheck

# End-to-end: real browsers (Chromium + Firefox) against the compose stack
docker compose up -d --build
docker compose --profile e2e run --rm e2e
```

## Redeploying after changes

```bash
docker compose up -d --build server web      # rebuild and restart backend + web
```

Flyway migrations run automatically on server start. Realm changes in
`deploy/keycloak/enclave-realm.json` are imported only into a *fresh* Keycloak; to keep existing
users, apply them to the running realm through the admin API/console instead of recreating it.

## Fast iteration

* **Web:** `cd apps/web && npm run dev` serves on http://localhost:5173 and proxies `/v1` and
  `/auth` to the compose stack (`ENCLAVE_DEV_BACKEND` overrides the target).
* **Backend:** stop the `server` container, then run
  `cd server && DB_URL=jdbc:postgresql://localhost:5433/enclave DB_PASSWORD=enclave-dev-db ./gradlew bootRun`
  and point nginx/Vite at it, or run the web app with `ENCLAVE_DEV_BACKEND=http://localhost:8080`.

## Repository layout

| Path | Contents |
|---|---|
| `server/` | Spring Boot / Spring Modulith backend (`docs.md` in every package) |
| `apps/web/` | React + TypeScript web client (`docs.md` in every folder) |
| `deploy/` | Keycloak realm, object-store config; later Helm/air-gap bundles |
| `tests/e2e/` | Playwright suite run against the compose stack |
| `docs/` | Specification, architecture, UI, tasks, decisions |
| `tasks.md` | Implementation progress log |

## Conventions

* UI changes: keep colours in `apps/web/src/ui/theme/tokens.ts` (contrast-tested), strings in both
  `en.ts` and `ro.ts`, and follow the patterns in UI.md §3.1 / ADR-0003.
* Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`) referencing task
  IDs from `docs/tasks.md` where relevant.
* Every package/folder has a `docs.md` describing its role, contents and architectural position;
  update it with the code.
* Configuration is typed (`@ConfigurationProperties` records, `enclave.*`), validated, and
  documented in `docs/configuration.md`. No hard-coded deployment values.
* Never log plaintext, keys, tokens, ciphertext payloads or stable personal identifiers.

## LAN, history and recovery

Open `https://localhost:8443` (or `https://convo.doncik.ro:8443` with a hosts entry pointing at this host).
Set `CONVO_SERVER_IP` (LAN address for call media) in `.env`; nothing in the repo hard-codes it.
`CONVO_HTTPS_PORT` changes HTTPS; `ENCLAVE_HTTP_PORT` changes the HTTP help-page port.
The generated certificate is in the `web-tls` volume; Keycloak's dev database is in `keycloak-data`.
Never change the canonical `OIDC_ISSUER` or deployment ID on an enrolled installation.

Message/conversation/profile changes are journaled in the same IndexedDB transaction, then uploaded
as opaque ciphertext to the account archive. Settings shows synchronization state and Retry. Logout
waits for archive synchronization before removing the browser's local keys. Linked/recovered devices
restore uploaded history without needing the old device online. Existing old-origin browser data
still belongs to that origin; changing from HTTP to HTTPS does not migrate IndexedDB automatically.

Save a recovery code in Settings before all devices are lost. Recovery requires Keycloak sign-in and
the saved code, preserves the account identity, and revokes lost devices. Live MLS group state is
not copied between devices; a fresh device must join the group for future traffic (ADR-0004).

Run E2E against the LAN address as well:

```bash
docker compose --profile e2e run --rm -e BASE_URL=https://convo.doncik.ro:8443 e2e
# hostname-only specs (passkeys): chat-lock, passkey-edge-cases, passwordless; config checks: identity-config
# production smoke tests after a deploy: see deploy/k8s.md (tests/e2e/smoke)
```
