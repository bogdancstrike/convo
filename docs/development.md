# Development guide

## Prerequisites

* Docker with Compose v2 (everything else runs in containers)
* For local iteration outside containers: JDK 21, Node.js 22+ (24 recommended)

## Run the whole stack

```bash
docker compose up -d --build        # postgres, valkey, keycloak, seaweedfs, server, web
open http://localhost:8088          # sign in as alice / alice-dev-password (also bob, carol)
docker compose logs -f server       # backend logs
docker compose down -v              # stop and delete all data
```

| URL | What |
|---|---|
| http://localhost:8088 | Web app (nginx; proxies `/v1` → server, `/auth` → Keycloak) |
| http://localhost:8088/auth/admin | Keycloak admin (`admin` / `admin-dev-password`) |
| http://localhost:5050 | pgAdmin (database "Enclave (dev)" pre-registered; password `enclave-dev-db`) |
| localhost:5433 | PostgreSQL (`enclave` / `enclave-dev-db`) |

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
