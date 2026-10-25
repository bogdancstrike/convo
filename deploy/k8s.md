# Kubernetes deployment (homelab)

Production runs on the homelab k3s cluster from the charts in
`deployment-configs-homelab` (`app-charts/convo`, third parties in `charts/`). Images are built by
`.github/workflows/docker-publish.yml` on every push and published to Docker Hub:

| Image | Built from | Chart |
| --- | --- | --- |
| `bogdancstrike/convo-server` | `server/Dockerfile` | `app-charts/convo/server` |
| `bogdancstrike/convo-web` | `apps/web/Dockerfile` | `app-charts/convo/web` |
| `bogdancstrike/convo-keycloak` | `deploy/keycloak/Dockerfile` | `app-charts/convo/keycloak` |
| `bogdancstrike/convo-admin` | `apps/admin/Dockerfile` | `app-charts/convo/admin` (`convo-admin.doncik.ro`) |

`VERSION` is the image tag published from the default branch; bump it (and the charts' `image.tag`)
to release. The repository secret `DOCKERHUB_TOKEN` must hold a Docker Hub access token.

The web image is the same-origin reverse proxy in both environments. In Kubernetes it runs with
`CONVO_TLS=off` (ingress terminates TLS) and `UPSTREAM_*` pointing at cluster services; see
`docs/configuration.md`. The Keycloak image bakes in the theme, the realm without development users
and the setup script (`/opt/convo/setup.sh`, run by the chart's post-sync Job).

## Release procedure

1. Commit and push to `master`; bump `VERSION` when the images should be rolled out. CI publishes
   `bogdancstrike/convo-{server,web,keycloak}:<VERSION>`.
2. In `deployment-configs-homelab`, set `image.tag` (and the chart versions) in
   `app-charts/convo/{server,web,keycloak}` to that version; commit and push.
3. On the server, `git pull` the deployment repository; sync `convo-keycloak`, `convo-server`
   and `convo-web` in ArgoCD (UI, CLI or `POST /api/v1/applications/<name>/sync`). The Keycloak
   post-sync Job re-applies realm settings (RP ID, required actions, service account, roles).
4. Run the production smoke tests (below). A failure means roll back the image tags.

## Production smoke tests

`tests/e2e/smoke` checks a live deployment without creating devices or messages: deployment info
and OIDC issuer, security headers, hidden Keycloak/actuator consoles, 401 for protected APIs, the
passkey result page, and a real passkey registration followed by a passkey-only sign-in (Chromium
virtual authenticator) on the deployment hostname. It needs a dedicated smoke account in the
`enclave` realm; remove that account's passkeys before each run (Keycloak admin:
`users/<id>/credentials`, type `webauthn-passwordless`), then:

```bash
cd tests/e2e
BASE_URL=https://convo.doncik.ro SMOKE_USERNAME=<smoke user> SMOKE_PASSWORD=<password> \
  npx playwright test -c smoke/playwright.smoke.config.ts
```

The same suite runs from the e2e image: `docker run --rm --network host -e BASE_URL=… -e
SMOKE_USERNAME=… -e SMOKE_PASSWORD=… -w /e2e enclave/e2e:dev npx playwright test -c
smoke/playwright.smoke.config.ts`. See [docs/SECURITY.md](../docs/SECURITY.md) for what each
check proves.

## Backups and restore

What holds Convo state, how the homelab protects it, and how to get it back. Message content is
end-to-end encrypted everywhere below: backups hold ciphertext and metadata, never readable chats.

| State | Where | Protection | Notes |
|---|---|---|---|
| Convo + Keycloak databases | Postgres cluster (PGO) | pgBackRest: weekly full, daily incremental, continuous WAL, last 4 full kept (`charts/postgres-cluster`) | Accounts, devices, mailboxes, groups, encrypted account archives, audit chain, policy (+ generated signing key) |
| Kubernetes secrets (`apps/convo-secrets` …) | Cluster | Velero weekly backup of namespaces (`charts/velero`) | LiveKit, TURN, S3, VAPID, admin client secrets |
| Encrypted attachments | MinIO bucket | **Not backed up** (Velero excludes the `minio` namespace, it is the backup target) | Losing it makes old attachments undownloadable; messages remain. Mirror the bucket off-site (`mc mirror`) if attachments matter |
| Audit checkpoints | `audit-checkpoints` volume | Velero file-system backup | Independent anchor for the hash-chained audit log |
| Calls VPS | `deploy/calls-vps/.env`, `certs/` (local, git-ignored) | Keep a private copy | Regenerable: new certificate → update both pinned PEMs in the charts; new secret → `create-secrets.sh` |

**Restore the database to a point in time** (e.g. before a bad migration): add to the
`PostgresCluster` spec

```yaml
backups:
  pgbackrest:
    restore:
      enabled: true
      repoName: repo1
      options: ["--type=time", "--target=\"2026-10-25 14:00:00+02\""]
```

then trigger it with `kubectl -n <pg-namespace> annotate postgrescluster postgres --overwrite
postgres-operator.crunchydata.com/pgbackrest-restore="$(date)"`, wait for the cluster to come back,
remove the `restore` block and restart `convo-server`. Clients reconnect on their own; messages
accepted after the target time are lost on the server (devices that already received them keep
them).

**Drill (quarterly):** restore the latest backup into a scratch PGO cluster, point a throwaway
`convo-server` at it, and check `/actuator/health`, an admin sign-in and the audit verify
(`GET /v1/admin/audit/verify`).
