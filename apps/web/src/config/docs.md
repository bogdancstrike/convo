# `src/config` — runtime configuration

`deployment.ts` loads `GET /v1/deployment-info` (deployment ID, organization name, supported API
versions, OIDC issuer/client). Because of this, a single web build serves any deployment; nothing
installation-specific is compiled in. An unsupported API version raises `UpdateRequiredError`,
which the UI renders as the "update required" state (UI.md §10).
