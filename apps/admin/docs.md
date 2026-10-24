# Admin console (`apps/admin`)

The organization admin console is a separate app on its own origin (production:
`https://convo-admin.doncik.ro`, Compose: `https://localhost:9443`). The messenger origin serves
no admin UI. The collapsible sidebar contains navigation, theme, roles and account controls;
content fills the viewport and long tables/details scroll within their own panels.

| Area | What it does | Permission |
|---|---|---|
| Overview & activity | Organization or selected-person statistics; 7/30/90-day trends, adoption and rankings; live system throughput per minute | `STATS_READ` (+ `ACCOUNTS_READ` for people) |
| Users | One directory for enrolled and pending sign-in accounts; creation, activity, devices, credentials, recovery, roles, audit and a user/device organization graph | `ACCOUNTS_READ` (+ per action) |
| Roles & permissions | Paginated role-member explorer, organization graph with quick details, comparison matrix, hover-focused permission map, and access-flow explanation modals | `ACCOUNTS_READ` (+ `ROLES_MANAGE` for assignments) |
| Audit log | Readable usernames with recorded-ID popovers; server-side search, column filters, sorting, pagination, verification, checkpoints and accountable export | `AUDIT_*` |
| Health | Push delivery counts and a searchable failure table; retry failed message wake-ups | `HEALTH_READ`, `PUSH_REDRIVE` |

Sign-in controls are in the same user view as activity and devices. The maximize button changes
`#/users/{account}/security` into `#/users/{account}/security?display=page`, retaining the selected
tab. Pending identities use `#/users/sign-in/{subject}`. Old `#/sign-in/{subject}` and
`#/activity/{account}` links redirect to the merged pages. Tabs, diagram focus, selected people,
searches, table queries and chart/table presentation are URL-backed, so Back/Forward restores
views. Table column visibility and density, sidebar state and theme are local preferences.

Management tables use `/v1/admin/tables/*` with server-side search/sort/filter before pagination.
The settings button controls visible columns and density. Charts and diagrams can also show the
complete plotted/node dataset as a searchable table; these derived presentation tables operate
on the already-fetched visualization values.

Security: OIDC PKCE through `convo-admin`, with tokens only in sessionStorage. A coordinated
refresh renews short-lived access tokens and handles resumed tabs, while sensitive actions still
require a recent sign-in. Logout stops new renewal before removing tokens. Every endpoint checks
its role/permission; administrative changes require an audited reason. Another administrator
must change your own roles or credentials. nginx serves only this console, `/v1/admin/*` and
realm sign-in, with strict CSP; master realm, account/admin consoles and messenger APIs are refused.

Identity events are imported from Keycloak every 15 seconds; device changes are audited in their
transaction. The audit source status is visible in the console. No audit entry contains messages,
keys, recovery secrets or arbitrary credential payloads. Activity items include receipts and
reactions: they are not a count of readable text messages. Minute throughput counts submissions,
call starts and upload-session starts separately. Message-type counts are not collected; text,
voice and media types remain encrypted pending a decision on aggregate client reporting.

Stack: React 18, Ant Design 5, React Flow 12, ECharts 5 and oidc-client-ts. Shared tokens in
`src/theme.ts` cover both themes. Checks: `npm run build`, `npm test`; integration tests live in
`tests/e2e/tests/admin*.spec.ts` and run against Docker Compose.
