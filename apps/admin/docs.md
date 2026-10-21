# Admin console (`apps/admin`)

The organization admin console (ADM-01), a separate single-page app on its own origin
(production: `https://convo-admin.doncik.ro`, Compose: `https://localhost:9443`). Keeping it out of
the messenger keeps the web app small and means the messenger origin serves no admin UI at all.

| Area | What it does | Permission |
|---|---|---|
| Overview | People, activity, devices, groups/channels/communities, calls; 7/30/90-day charts | `STATS_READ` |
| Users | Convo accounts: search, status, devices, last activity; drawer with activity, devices, sign-in, security | `ACCOUNTS_READ` (+ per action) |
| Sign-in accounts | IdP accounts incl. people not signed in yet; create, reset password (one-time temporary password), require passkey/2FA/password change, sign out everywhere, block sign-in, admin roles | `ACCOUNTS_READ`, `USERS_CREATE`, `USERS_CREDENTIALS`, `ROLES_MANAGE` |
| Activity | Most/least active people, search a person's activity level | `STATS_READ` + `ACCOUNTS_READ` |
| Audit log | Hash-chained log with search/filter, verify, checkpoint, accountable export | `AUDIT_*` |
| Health | Push wake-up delivery, retry failed wake-ups | `HEALTH_READ`, `PUSH_REDRIVE` |

Security: sign-in with the `convo-admin` Keycloak client (PKCE) on this origin; tokens only in
sessionStorage; the server checks the admin role and a scoped permission on every call; changes
need a reason (audited), credential and role changes also a recent sign-in, and nobody can change
their own credentials or roles. nginx serves only the console, `/v1/admin/*` and the realm's
sign-in pages (consoles, master realm and the messenger API return 404); strict CSP
(`script-src 'self'`).

Stack: React 18, Ant Design 5, ECharts 5, oidc-client-ts; design tokens in `src/theme.ts` feed
both Ant Design and the charts (light/dark). `npm run build`, `npm test`.
