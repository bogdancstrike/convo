# `admin` — organization administration (ADM-01, first slice)

**Architecture position:** a leaf module. Depends on public identity, statistics and domain-event APIs. Nothing depends on it. It never touches message content, keys, archives or private group membership, so administrators cannot read content or silently add themselves to chats.

| Type | Role |
|---|---|
| `AdminController` | `/v1/admin/**`: account search, devices, disable/enable, revoke device (each with a mandatory reason), audit page and chain verification. |
| `AdminActions` | Applies a change and appends its audit entry in one transaction. |
| `AuditCheckpoints` | Every `enclave.admin.checkpoint-interval` (and on demand) appends `seq head time` to `enclave.admin.checkpoint-file` when the chain grew and verifies; `/audit/verify` compares recomputed heads with every checkpoint. Mount that path on write-once/off-host storage in production. |
| `AuditLog` | Append-only `admin_audit` (V18); `hash = SHA-256(prev_hash ‖ seq, at, actor, action, target, reason)`; appends serialized by a table lock; `verify()` recomputes the chain. Export the head to an independent store: a rewritten database no longer matches it. |

Security: a dedicated filter chain (`SecurityConfig.adminChain`) accepts only Keycloak tokens
whose `realm_access.roles` contains `enclave.admin.role` (default `convo-admin`). No device
signature is involved. The web console is `apps/admin`, served on a separate origin.

Step-up: disable/enable/revoke require the token's `auth_time` to be within
`enclave.admin.step-up-max-age` (default 10 min); otherwise `STEP_UP_REQUIRED` and the console
sends the admin through sign-in again.

Scoped roles (specs §19, AC-ADM-01; `AdminPermissions`): `convo-admin` = everything;
`convo-helpdesk` = accounts, devices, revoke a device; `convo-org-admin` = accounts,
disable/enable; `convo-security` = accounts, devices, revoke, disable, read audit;
`convo-auditor` = read/verify/export/checkpoint the audit log. The security chain admits any of
them; each endpoint checks its permission. Denied sensitive attempts are appended to the audit
chain (`denied:<action>`). `GET /v1/admin/me` lists the caller's roles/permissions (the console
hides the rest); `POST /v1/admin/audit/export {reason}` records `audit.export` before returning
the full chain with its verification. Role names: `enclave.admin.roles.*`; `keycloak-setup`
creates the roles.

Not yet: signed policies and auditing of read-only lookups.

## Identity and user audit (V27)

The console is `apps/admin`, served on a separate origin. Its Users directory combines enrolled
Convo accounts and pending Keycloak accounts. Overview & activity shares a date window and optional
person scope. Older `#/activity/{account}` and `#/sign-in/{subject}` links redirect to the merged pages.

`UserActionAudit` consumes `DeviceRegistered` and `DeviceRevoked` synchronously: device enrollment,
unlinking and unregistering the current device are committed with their audit entry. Actors include
the authenticated IdP subject or originating device. `UserRequestAudit` records recovery setup/use,
link approval/cancellation, privacy changes and group/community/call mutations and failed attempts.
It stores route templates and status codes, never bodies, encrypted content, recipient/chat IDs,
keys or recovery secrets. Encrypted transport, attachment/history sync, automatic heartbeats and
client-local settings are not individual audit events.

`IdentityAuditImporter` polls Keycloak's user events every 15 seconds (override
`enclave.admin.audit-poll-interval`). Login/logout, failed authentication, profile updates,
password changes, credential/passkey additions/removals and other saved identity events enter the
same hash chain with their original timestamps. Protocol exchanges and service-account logins are
excluded. Only username, event type, client and error code are copied; arbitrary event details,
IP addresses, credential IDs, session IDs and tokens are never copied. A database cursor and
source event IDs commit with the chain append, making retries/restarts idempotent. The importer
uses a fixed upper bound and a 60-second overlap to accommodate late commits. It catches up from
the persisted cursor after outages; Keycloak retains the source for seven days. Events predating
event-storage enablement cannot be reconstructed. Keep the importer outage shorter than source
retention; externalize the audit/checkpoints for longer-term protection.

The idempotent Keycloak setup enables event storage on existing realms and grants `view-events`
to `convo-admin-ops`, alongside existing user-management roles. Re-run `docker compose run --rm
keycloak-setup` after upgrading an existing deployment. The console reports configuration/sync
failures from `GET /v1/admin/audit/sources` (requires `AUDIT_READ`). A successful poll means the
source request completed; event storage must remain enabled in Keycloak.

`GET /v1/admin/audit` applies `q`, `action` (exact or category prefix), `user` (comma-separated IdP
and/or Convo identifiers), ISO `from`/`to`, and `before` sequence filters before a bounded page is
returned. User drawers use both identifiers. The page exposes search, user/category/date filters,
refresh and older-event loading; verification and exports still operate on the whole hash chain.

Admin tokens stay in sessionStorage. A single-flight refresh renews within 60 seconds of expiry
and on resumed/expired sessions, with one refresh/retry for an API 401. Temporary connectivity
failures retain refresh credentials. Explicit logout clears the session and redirects to Keycloak.
Refreshing a token does not reset `auth_time`: sensitive actions retain the ten-minute step-up.

## Table and throughput views

Management tables share `/v1/admin/tables/{people,role-holders,permissions,audit,activity,health}`.
`q`, whitelisted `sort`, `order=asc|desc`, `page`, `size` (1–100) and `f_<column>` search filters
are applied before paging. Audit queries run in PostgreSQL; directory/role sources consume the
identity provider's complete paged source before filtering and sorting, rather than sorting a
truncated browser page. Provider enumeration is bounded at 100,000 identities and fails explicitly
if exceeded. The people table retains Convo users with an unavailable/deleted IdP record and
reports an IdP outage instead of silently hiding the directory. Column display and density are
local preferences; query state lives in the URL for Back/Forward and sharing.

V29 adds `actor_name` and `target_name` projections for audit table sorting/search. They are not
part of the signed canonical fields. Existing rows are backfilled in batches of 500; the original
actor/target/hash remain unchanged. Username, device number and historical snapshots are visible
in the table; recorded identifiers remain in a detail popover.

V28 counts accepted encrypted submissions, new calls and attachment upload sessions per UTC
minute. Counters update transactionally with the accepted operation, and carry no sender,
recipient, attachment ID or content. Counters are retained for two days and displayed over 1/6/24
hours. Upload sessions count starts, not successful object-storage completion; a sent attachment
may contribute both one upload session and encrypted submissions. Minutes before recording began
are shown as missing observations, not invented history. The current minute is partial. This
telemetry respects `enclave.admin.activity.enabled` and does not reveal text/media/voice types.

## System health

`GET /v1/admin/health/system` requires `HEALTH_READ`. It returns a cached snapshot containing
component status, check scope, sanitized result, elapsed milliseconds and check time. The existing
`GET /v1/admin/health` remains the independent push-delivery diagnostic endpoint.

The snapshot checks application readiness, a PostgreSQL connection/query, Valkey PING, Keycloak
realm signing keys, identity-audit importer freshness, authenticated attachment-bucket access,
LiveKit signalling readiness, ntfy's health response, local browser-push configuration, a TURN/STUN
UDP binding exchange, both frontend documents, and the optional database console. Checks run in
parallel with a total budget; one timeout does not discard other components' results. Required
failures make overall health unavailable; supporting-service failures and missing required checks
make it degraded. Disabled and unverified integrations are displayed explicitly.

`enclave.admin.health.timeout` defaults to `2s` (positive, at most `10s`);
`enclave.admin.health.cache-ttl` defaults to `10s` (between `1s` and `5m`). Requests cannot override
probe targets or bypass the shared cache. Component results never include configured addresses,
credentials, exception messages or remote error bodies.

Compose configures these internal targets through the corresponding `ENCLAVE_ADMIN_HEALTH_*`
variables:

- `WEB_URL`: `http://web:8081/healthz`
- `ADMIN_URL`: `http://admin:8081/healthz`
- `OPERATIONS_URL`: `http://pgadmin:80/misc/ping`
- `TURN_HOST`: `coturn`, with `TURN_PORT` defaulting to `3478`

The frontend nginx templates expose only the static frontend document on their internal health
listener at port 8081; Compose does not publish that port. Other deployments should set equivalent
trusted internal targets. Missing targets are unverified, never assumed healthy. The other probes
use the server's effective database, Redis, identity, attachment, calling and push configuration.

These checks are intentionally read-only: object-storage writes, TURN relay allocation, external
media routes and delivery through third-party browser push providers are not exercised. The UI
shows these scopes in the component details. Browser push with configured VAPID credentials is
unverified for delivery; disabled browser push is displayed as disabled. Database console is an
optional operations tool. Identity setup is a one-shot deployment job, not a continuously running
service; subsequent realm access and synchronization are checked through identity and audit probes.

The admin Health page refreshes every 30 seconds. It preserves the last snapshot on a refresh
failure and warns when results exceed 90 seconds. Search/status filters, details and tabs live in
the URL for Back/Forward. Push diagnostics load independently, and retain audited retry controls.
