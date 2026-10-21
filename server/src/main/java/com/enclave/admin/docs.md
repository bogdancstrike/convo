# `admin` — organization administration (ADM-01, first slice)

**Architecture position:** a leaf module. Depends on `identity.IdentityAdminApi` (account/device
metadata, disable, revoke). Nothing depends on it. It never touches messages, keys, archives or
group membership, so administrators cannot read content or silently add themselves to chats.

| Type | Role |
|---|---|
| `AdminController` | `/v1/admin/**`: account search, devices, disable/enable, revoke device (each with a mandatory reason), audit page and chain verification. |
| `AdminActions` | Applies a change and appends its audit entry in one transaction. |
| `AuditCheckpoints` | Every `enclave.admin.checkpoint-interval` (and on demand) appends `seq head time` to `enclave.admin.checkpoint-file` when the chain grew and verifies; `/audit/verify` compares recomputed heads with every checkpoint. Mount that path on write-once/off-host storage in production. |
| `AuditLog` | Append-only `admin_audit` (V18); `hash = SHA-256(prev_hash ‖ seq, at, actor, action, target, reason)`; appends serialized by a table lock; `verify()` recomputes the chain. Export the head to an independent store: a rewritten database no longer matches it. |

Security: a dedicated filter chain (`SecurityConfig.adminChain`) accepts only Keycloak tokens
whose `realm_access.roles` contains `enclave.admin.role` (default `convo-admin`). No device
signature is involved. The web console is `apps/web/admin.html`, served at `/admin`; production
deployments should serve it from a separate origin.

Step-up: disable/enable/revoke require the token's `auth_time` to be within
`enclave.admin.step-up-max-age` (default 10 min); otherwise `STEP_UP_REQUIRED` and the console
sends the admin through sign-in again.

Not yet: scoped/limited admin roles, signed policies, and auditing of read-only lookups/denials.
