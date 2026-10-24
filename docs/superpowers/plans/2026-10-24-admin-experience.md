# Admin Experience Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task, with checks between backend and frontend changes.

**Goal:** Unify the admin workspace, make role assignments navigable, filter activity by person, audit identity actions, and renew admin sessions.

**Architecture:** Retain the existing Ant Design console and permission checks. Consume identity domain events synchronously for transactional device audit, and import authoritative Keycloak events through a durable, deduplicated cursor. Keep sensitive action step-up independent of access-token renewal.

**Tech Stack:** React 18, Ant Design 5, React Flow 12, ECharts, oidc-client-ts, Spring Boot, JDBC/PostgreSQL, Keycloak.

---

### Task 1: Session renewal
- [ ] Add single-flight refresh and pre-expiry renewal in `apps/admin/src/auth.ts`, retry one expired-token API response in `api.ts`, and test expired tokens, concurrent requests, renewal failures, and logout.
- [ ] Run `cd apps/admin && npm test`.

### Task 2: Unified navigation and people
- [ ] Merge navigation in `Shell.tsx`, redirect legacy activity/sign-in routes with their identifiers.
- [ ] Combine accounts and pending sign-in identities in `pages/Users.tsx`; preserve creation, account drawers, sign-in controls, independent loading failures, and explicit filters.
- [ ] Extract `CreateUser` into a component; remove obsolete standalone pages.

### Task 3: Overview and per-person activity
- [ ] Merge overview charts, activity levels and rankings in `pages/Overview.tsx` and reusable activity components. Use the existing account activity endpoint for a selected person; display only that person's metrics and fill missing dates with zero.
- [ ] Guard user selectors/rankings with `ACCOUNTS_READ`; retain aggregate overview for auditors.

### Task 4: Role explorer
- [ ] Structure `pages/Roles.tsx` around an accessible role selector, focused assignment/permission detail, comparison matrix, and a React Flow organization → role → holder organigram. Preserve grant/remove controls and permission map.

### Task 5: Identity audit
- [ ] Add domain audit consumers for device registration/revocation. Add metadata-only auditing of successful authenticated user mutations, excluding payloads, keys and message content.
- [ ] Add Keycloak event fetching to `KeycloakUsers.java`, a durable importer, and a Flyway cursor/deduplication migration. Import login/logout, failed authentication, passkeys/credentials/profile/recovery events, preserving source times and never event details containing secrets.
- [ ] Enable realm event storage and grant `view-events` to the existing operations service account in the realm bootstrap.
- [ ] Add database-backed audit filters and pagination; expose user, action, date, refresh, and older events in the audit UI and account drawers.
- [ ] Add targeted importer, mapping, filter, and domain-consumer tests.

### Task 6: Validation and docs
- [ ] Run admin test/build, server tests including module boundaries, and available browser checks.
- [ ] Update admin/deployment documentation with audit coverage, polling and setup requirements; record validation limits.

## Accepted additions during implementation

- Put theme, identity and role controls in a collapsible sidebar; remove the header.
- Make significant tabs, chart scope, filters, pagination and detail presentation URL-backed so Back/Forward restores the view.
- Use a single user detail surface for pending and enrolled users; support maximizing it into a page.
- Add a user/device organization graph with identity, phone, administrator roles and real device metadata.
- Add diagram detail inspectors/modals, straight edges, stable hover focus, and component-contained scrolling.
- Add chart/table views for numerical plots and diagrams, plus inspectable plotted values.
- Add consistent table column settings, real backend sorting/filtering/search and bounded pagination to management tables.
- Display readable audit names as projections outside the signed fields; backfill historical projections without changing the hash chain.
- Add system throughput per minute for accepted encrypted items, calls started and upload sessions created, without account dimensions.
- Message-type reporting remains awaiting the user's explicit choice about aggregate client telemetry; no content-type inference or fabricated values.
- Commit and push milestones on `feat/admin-workspace-audit`; redeploy Docker Compose for review.
