# `deploy/` — deployment assets

| Path | Purpose |
|---|---|
| `keycloak/` | Development realm import (PKCE client, TOTP/passkey policy, test users) |
| `pgadmin/` | pgAdmin server registration for the compose database (dev UI on :5050) |
| `seaweedfs/` | Development S3 identities for the object store |

The root `docker-compose.yaml` runs the complete development stack. Kubernetes/Helm charts,
air-gap bundles and production overlays (OPS-01) will live here as well.
