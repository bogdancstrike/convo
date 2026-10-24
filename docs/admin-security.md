# Session management and security alerts

The admin console runs on its own origin. These tools expose security metadata only; they cannot
read encrypted messages, attachments, recovery secrets or conversation content.

## Live sessions

Open **Live sessions**, search for a person, and inspect their online Keycloak sessions. The same
list appears in the **Sessions** tab of a user's drawer or full page. Tables support backend
search, column filters/sorting, pagination (10 rows initially), visibility settings and resizing.
They refresh every 15 seconds. Session details support maximize and browser Back/Forward.

Each row shows the username, browser/OS family when observed, participating client applications,
source IP reported by Keycloak, sign-in time and last identity-provider activity. Browser/OS
metadata is derived from the user agent on successful JWT-authenticated API requests after this
feature was installed. It is self-reported and is not fingerprinting or proof of a physical
device. Legacy sessions without an observation say **Not observed**. Keycloak's source IP may be
an ingress/proxy address; no geolocation or automatic trust decision is made from it.

**End session** checks that the selected session currently belongs to the person in the URL,
then calls Keycloak's single-session deletion endpoint. **End all sessions** uses its user logout
endpoint. Both require a mandatory reason, `SESSIONS_REVOKE`, and a sign-in within the configured
step-up window (10 minutes by default). The audit records `session.end` or `user.sign-out`, the
operator, person and reason; it does not export the raw session identifier. A session that has
already ended returns a clear not-active result. Administrators can deliberately end their own
session; this action has an explicit confirmation.

These operations end online identity-provider sessions and prevent further token refresh.
Already issued stateless access tokens can remain valid until their normal expiry. Enrolled
messaging devices use separate device credentials and remain linked. To stop a messaging device,
use **Unlink device**; do not treat identity-session logout as device revocation. Offline sessions
are not included in this manager.

## Security alerts inbox

**Security alerts → Inbox** lists persisted alerts. Filter by status, severity or rule, search
people/details, sort/filter each data column, and open a row for evidence and history. Counts show
open, acknowledged and critical unresolved alerts. The sidebar badge counts all open alerts.
Details can be maximized, reloaded or restored through browser Back/Forward.

Security operators can **Acknowledge**, **Resolve**, or **Reopen** an alert with a recorded reason.
Those changes and rule edits are added to the hash-chained audit. Resolved alerts, lifecycle
history, source evidence and disabled rules' existing alerts are retained. The details panel shows
the latest 100 lifecycle changes; older changes remain in the database and audit. Alerts are
signals to investigate, not automatic findings of account compromise. They do not block users or
revoke sessions automatically.

### Built-in rules

| Rule | Default severity | Default trigger | Grouping |
| --- | --- | --- | --- |
| Repeated failed logins | High | 5 `auth.login.failed` events in 5 minutes | Recorded sign-in identity; unknown subjects retain the recorded username when available |
| Device enrollment burst | Medium | 3 `device.add` events in 10 minutes | Convo account |
| Privileged role granted | High | Each `role.grant` through the Convo admin API | Unique audit entry |
| Identity audit sync unavailable | Critical | No successful identity import within 2 minutes | One alert per observed outage episode |

The first two rules count a rolling source-time window ending at each newly processed event,
bounded by that event's committed audit sequence. Repeated triggers form one episode per rule and
identity: while an unresolved alert exists whose latest event falls within the rule window, new
matching events extend its count and evidence times (an acknowledged alert stays acknowledged).
Once the alert is resolved, or the burst pauses longer than the window, the next trigger opens a
new alert. Exact lower window boundaries are excluded; the event timestamp is included.

Privileged role alerts cover grants made through Convo's administrative API. Role changes made
directly in Keycloak are outside the current user-event importer and do not claim detection.
Failed logins and credential events depend on enabled Keycloak event storage and successful
identity import. The sync-outage rule runs independently of source-event ingestion and waits its
configured grace period after backend startup. Source recovery clears the episode marker; it
does not silently resolve the existing investigation. A later outage creates a new alert.

**Detection rules** allows administrators/security operators to enable/disable each rule, set
severity, configure thresholds/windows, and control notifications. Role grants always trigger
individually; the audit-sync window is its grace period. Changes require a reason and recent
sign-in. They apply to subsequently processed events, including pending ingestion, without
rewriting existing alert severity or replaying older processed audit entries.

### Processing, failure and notifications

A bounded database projection runs every 15 seconds, processing up to 1,000 audit entries per
batch. A row-locked durable cursor serializes replicas. Alert insertion, detection history,
deduplication and cursor advancement commit together; failures roll back and retry, and the inbox
reports a sanitized processing error. Backlogs can therefore delay alert availability. Identity
import and alert projection each have their own polling interval.

Migration V30 initializes the alert cursor at the existing audit head. Existing retained events
are not replayed into a notification flood. New alerts are deduplicated across restart/retry.
The **Detection checked** time indicates the last committed processing batch. Alerts are available
through the inbox even when desktop notification permission is denied.

Per-rule **Notifications** controls the in-app notification count and optional desktop alerts.
Each administrator can explicitly enable desktop notifications in their browser; browser permission
and local storage are required. Only alerts created after opt-in are eligible. A per-administrator
browser-local seen list deduplicates recent notifications across page navigation/reload. Polling
checks the latest 20 eligible open alerts; the durable inbox remains the full source of truth.
Desktop notifications require an open signed-in console, are best-effort, and are not a background
push, email or webhook delivery service. Disabling notification rules does not remove inbox rows.

## Permissions and API

| Role | Read sessions | End sessions | Read alerts/rules | Change alert status | Edit rules |
| --- | --- | --- | --- | --- | --- |
| Administrator | Yes | Yes | Yes | Yes | Yes |
| Helpdesk | Yes | Yes | No | No | No |
| Organization admin | Yes | Yes | No | No | No |
| Security | Yes | Yes | Yes | Yes | Yes |
| Auditor | No | No | Yes | No | No |

The scopes are `SESSIONS_READ`, `SESSIONS_REVOKE`, `ALERTS_READ`, `ALERTS_MANAGE` and
`ALERT_RULES_MANAGE`. They are server-enforced; hiding controls is not authorization. Existing
realm roles are sufficient, so no new Keycloak role or broad service-account grant is required.
The operations client already has `manage-users`, `view-users`, `view-realm` and `view-events`.

| Endpoint under `/v1/admin` | Purpose |
| --- | --- |
| `GET /tables/sessions?user={subject}` | Selected person's live session table; normal `q`, `sort`, `order`, `page`, `size`, `f_{column}` parameters |
| `POST /idp/users/{subject}/sessions/{session}/end` | End one owned online session; `{reason}` |
| `POST /idp/users/{subject}/sign-out` | End all online sessions; `{reason}` |
| `GET /tables/alerts` | Backend inbox search/sort/filter/paging plus `status`, `severity`, `ruleId` scopes |
| `GET /alerts/summary` | Counts, recent notification candidates, processor time/error |
| `GET /alerts/{id}` | Alert and latest lifecycle history |
| `POST /alerts/{id}/status` | `{status: open\|acknowledged\|resolved, reason}` |
| `GET /alerts/rules` | Current persisted rule configuration |
| `POST /alerts/rules/{id}` | `{enabled, severity, threshold, windowMinutes, notificationsEnabled, reason}` |

Reads return `Cache-Control: no-store`. Session IDs and observation rows remain internal metadata;
responses never contain access/refresh tokens or arbitrary user-agent strings. Alert database
queries whitelist sortable/searchable fields and bind values. Alert mutations and audit appends
share a database transaction. Keycloak logout is an external effect: its successful execution
cannot be rolled back if a later local audit append fails; retry can find the session already ended.

## Deployment and retention

V30 adds `admin_session_observation`, `admin_alert_rule`, `admin_security_alert`,
`admin_alert_history` and `admin_alert_cursor`, plus an audit detection index. Back up the database
and deploy backend/frontend images from the same revision. Standard Flyway startup applies the
migration; no new external service, secret or volume is needed. `ENCLAVE_ADMIN_ALERT_POLL_INTERVAL`
sets the backend projection interval (default `PT15S`). Rule values are persisted in PostgreSQL,
not Helm values, so upgrades preserve operator edits.

No automatic deletion is installed for alerts, lifecycle history or session observations. External
maintenance owns their retention, consistent with [the retention policy](retention.md). Removing
source audit history independently can weaken investigations and checkpoint verification; archive
it deliberately with the required integrity material.
