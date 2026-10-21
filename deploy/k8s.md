# Kubernetes deployment (homelab)

Production runs on the homelab k3s cluster from the charts in
`deployment-configs-homelab` (`app-charts/convo`, third parties in `charts/`). Images are built by
`.github/workflows/docker-publish.yml` on every push and published to Docker Hub:

| Image | Built from | Chart |
| --- | --- | --- |
| `bogdancstrike/convo-server` | `server/Dockerfile` | `app-charts/convo/server` |
| `bogdancstrike/convo-web` | `apps/web/Dockerfile` | `app-charts/convo/web` |

`VERSION` is the image tag published from the default branch; bump it (and the charts' `image.tag`)
to release. The repository secret `DOCKERHUB_TOKEN` must hold a Docker Hub access token.

The web image is the same-origin reverse proxy in both environments. In Kubernetes it runs with
`CONVO_TLS=off` (ingress terminates TLS) and `UPSTREAM_*` pointing at cluster services; see
`docs/configuration.md`.
