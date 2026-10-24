# Admin Sessions and Security Alerts Implementation Plan

> **For agentic workers:** Execute inline with verification checkpoints, as authorized by the user. Continue periodic commits, pushes and Docker Compose deployment; update production charts after image publication.

**Goal:** Ship an auditable user-session manager and a durable, configurable security alerts inbox.

**Architecture:** Use Keycloak as the source of active online sessions, with backend filtering/paging and scoped session permissions. Record only browser/OS family from authenticated session observations; never infer an encrypted device association. Project new audit entries through a transactional, restart-safe cursor into durable alerts; monitor identity-audit collection independently. Existing audit history remains unchanged. Notification rules drive the in-app inbox and optional browser notifications, with no automatic data deletion.

**Tech Stack:** Spring Boot/JDBC/PostgreSQL/Flyway, Keycloak Admin REST, React/Ant Design, JUnit/Vitest/Playwright, Docker Compose, Helm.

### Task 1: Sessions
- [ ] Add Keycloak online-session retrieval and single-session logout; test the exact REST requests and session ownership verification.
- [ ] Add session read/revoke scopes, reason/step-up checks, audit records and safe browser-family observations. Reuse the existing all-session logout endpoint and strengthen its step-up check.
- [ ] Add `/sessions`, searchable person selection, live refresh, shared backend table controls and session details with maximize/Back behavior. Integrate a Sessions tab into the user detail surface.
- [ ] Verify single/all logout, surviving unrelated sessions, forbidden roles, stale sign-in and browser metadata limitations.

### Task 2: Security alerts
- [ ] Create `V30__admin_security.sql` with persisted rules, alert lifecycle/history, processing cursor and session observations. Initialize the cursor at the current audit head to avoid historic notification floods.
- [ ] Add an idempotent alert processor for failed-login and device-enrollment thresholds, privileged role grants and audit source outages. Preserve evidence links and processing errors; never advance a failed batch.
- [ ] Add backend paging/search/filter/sort, summary and detail endpoints; audited acknowledgment/resolution/reopen and rule editing with security/auditor access separation.
- [ ] Add `/alerts` inbox, counts, severity/status filters, URL-backed details/maximize, rules editor and optional browser notifications. Deduplicate notifications per browser and show stale/error states.
- [ ] Test detection windows, deduplication, lifecycle, access controls, rule validation, notifications and browser history.

### Task 3: Delivery and documentation
- [ ] Update README, specs, admin/module/UI/configuration/retention documentation and migration notes with exact behavior, permissions and token/session limitations.
- [ ] Run backend/unit/type/build checks, deploy Compose and run Chromium/Firefox end-to-end coverage.
- [ ] Commit/push application changes and verify published images.
- [ ] Update production Convo charts and any necessary service wiring, lint/render/assert, then commit/push the infrastructure repository.
