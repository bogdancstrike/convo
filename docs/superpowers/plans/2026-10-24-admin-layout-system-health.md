# Admin Layout and System Health Implementation Plan

> **For agentic workers:** Execute inline, task by task, with verification checkpoints; continue the user's authorized deployment and commit/push workflow.

**Goal:** Compact role-holder columns, fix People table overflow, relocate overview charts, and expose real component health for the deployed system.

**Architecture:** Keep backend-driven tables and URL-backed chart controls. Constrain table flex items rather than masking horizontal overflow. Add an authorized, cached health snapshot with bounded parallel read-only probes; preserve independent push diagnostics and make unavailable/disabled/unconfigured components explicit.

**Tech Stack:** React/Ant Design/ECharts, Spring Boot/JDBC/Redis/S3, Java HTTP/UDP, Docker Compose, Vitest/JUnit/Playwright.

### Task 1: Overview and table layout
- [x] Update `Overview.tsx`: Throughput beside Calls on Usage trends; New people beneath rankings on People; normalize the old throughput tab URL.
- [x] Update `ThroughputChart.tsx`: compact header/window controls and a 240px plot suitable for a half-width card; keep chart/table/history and accurate counts.
- [x] Update `AdminTable.tsx`, `Roles.tsx`, `admin.css`: allow content-sized role columns, constrain intrinsic flex widths, truncate long names with accessible full labels, keep internal horizontal scrolling.
- [x] Re-run the reproduced People overflow regression and real throughput scenario in Chromium/Firefox; check browser Back and backend table controls.
- [x] Build/redeploy admin; commit and push the verified layout milestone.

### Task 2: Component health backend
- [x] Add `SystemHealthProperties`, `SystemHealth`, `SystemHealthController` in `admin/internal`: HEALTH_READ authorization, server-selected probe targets only, 10-second cache, bounded parallel checks, safe failure messages and latency/timestamps.
- [x] Check backend readiness, PostgreSQL, Valkey, identity provider, S3 bucket, calls signalling, notification distributor, TURN, web/admin frontends and optional operations UI; include identity audit freshness. Disabled/unconfigured integrations must never appear healthy.
- [x] Add internal frontend health listeners and Compose probe addresses, including the TURN service address; do not expose Docker sockets or credentials.
- [x] Add JUnit coverage for failure isolation, timeouts, aggregation, caching, disabled/unconfigured states, HTTP status/body validation and TURN response validation. Run backend tests and module boundaries.

### Task 3: Health UI and deployment
- [x] Update `api.ts` and `Health.tsx`: overall health, component groups, status/latency/check times, search/status filters and details; retain push KPIs and audited retry controls in a separate tab.
- [x] Auto-refresh safely, display stale/unreachable snapshots and independent request failures, and keep scrolling inside the active panel.
- [x] Add browser coverage for component coverage and degraded/disabled states; verify helpdesk access and refusal for roles without HEALTH_READ.
- [x] Build/test backend and admin, redeploy Compose, verify real probes and screenshots, update operational docs, commit and push.

Layout validation: 23 unit tests and eight browser scenarios passed across Chromium and Firefox, including the reproduced People width failure. Throughput counts real accepted operations in the overview row.

Completed validation: 96 backend tests, 23 admin unit tests and 31 applicable Chromium/Firefox admin browser scenarios pass across the full run and the corrected throughput-label assertion. The Firefox-only passkey limitation remains a deliberate skip. Health checks, larger balanced cards, table resizing and current Docker Compose deployment are verified.
