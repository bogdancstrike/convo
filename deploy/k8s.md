# Kubernetes deployment (homelab)

Production runs on the homelab k3s cluster from the charts in
`deployment-configs-homelab` (`app-charts/convo`, third parties in `charts/`). Images are built by
`.github/workflows/docker-publish.yml` on every push and published to Docker Hub:

| Image | Built from | Chart |
| --- | --- | --- |
| `bogdancstrike/convo-server` | `server/Dockerfile` | `app-charts/convo/server` |
| `bogdancstrike/convo-web` | `apps/web/Dockerfile` | `app-charts/convo/web` |
| `bogdancstrike/convo-keycloak` | `deploy/keycloak/Dockerfile` | `app-charts/convo/keycloak` |

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
