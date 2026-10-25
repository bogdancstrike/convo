# `deploy/` — deployment assets

| Path | Purpose |
|---|---|
| `keycloak/` | Development realm import (PKCE client, TOTP/passkey policy, test users) |
| `pgadmin/` | pgAdmin server registration for the compose database (dev UI on :5050) |
| `seaweedfs/` | Development S3 identities for the object store |
| `calls-vps/` | LiveKit + coturn on a public VPS (call media cannot go through the tunnel) |
| `kt-witness/` | Key-transparency witness: co-signs consistent log heads (run on another machine) |
| `convo-bot/` | Archive/bot runtime for visible integration accounts (device-grant sign-in) |
| `k8s.md` | Kubernetes/Helm deployment and backups runbook |
| `vapid-keys.sh` | Generates the Web Push VAPID key pair |

The root `docker-compose.yaml` runs the complete development stack. Kubernetes/Helm charts,
air-gap bundles and production overlays (OPS-01) will live here as well.
