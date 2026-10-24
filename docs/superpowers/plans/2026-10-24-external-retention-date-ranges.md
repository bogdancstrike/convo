# External Retention and Overview Date Ranges Implementation Plan

> **For agentic workers:** Execute inline with verification checkpoints. Preserve the authorized UI refinements and periodic commit/push/deployment workflow.

**Goal:** Make retention an external operations responsibility, and support 1d/7d/30d/custom chart ranges in the overview scope card.

**Architecture:** Remove every application-scheduled retention purge and opportunistic age/cap cleanup; preserve explicit user operations and one-time credential consumption. Existing expiry metadata can support external maintenance, while persistent messages/attachments remain accessible until externally removed. Use a shared validated UTC date-range model across aggregate, user, ranking and throughput queries. Keep chart queries bounded through throughput aggregation, not data deletion.

**Tech Stack:** Spring Boot/JDBC/PostgreSQL, Keycloak configuration, React/Ant Design/ECharts, JUnit/ArchUnit/Vitest/Playwright, Docker Compose.

### Task 1: External retention
- [x] Remove scheduled activity, throughput, calls, attachment, mailbox, idempotency, reservation, provisioning, replay-ID, nonce and WebSocket-ticket retention jobs; remove the push scheduler's purge registration and inline audit dedup cleanup.
- [x] Remove nonce-cap pruning on issue. Preserve expiry checks for credentials and consumption of single-use secrets.
- [x] Remove age filters on retained mailbox/attachment content, update Keycloak events to no automatic expiration, and replace finite-retention UI text and API metadata.
- [x] Add regression coverage for the absence of retention schedules and continued old-record availability; document external maintenance ownership and the remaining operational schedules.
- [x] Run backend/admin tests, redeploy and commit/push the retention change.

### Task 2: Explicit overview ranges
- [x] Add a shared inclusive UTC date-range validator: 1d, 7d, 30d and custom start/end, with explicit invalid/reversed/future range errors.
- [x] Apply from/to to aggregate series, activity levels, user activity and backend rankings; exclude data outside both bounds. Include actual range metadata for zero-filled client plots.
- [x] Extend throughput to from/to with bounded bucket aggregation and per-minute rates; preserve the existing minutes query for API compatibility.
- [x] Move the overview date controls from the page heading into the scope card, right aligned beside its period label; use a custom date picker and URL-backed range history.
- [x] Verify range boundaries, single-day and old historical data, throughput bucket math, user scope, browser Back, and mobile layout.
- [x] Run tests/build, redeploy, update docs and commit/push the completed range milestone.

Backend validation: 96 JUnit tests and module-boundary checks pass. The application and realm retention changes are deployed. Range and resize browser checks pass in Chromium and Firefox; broader admin regressions are running.

Completed validation: inclusive historical and single-day ranges, custom picker entry, browser Back, scope-card placement and mobile layout pass in Chromium/Firefox. Management and chart-data tables both support equal initial columns, pointer/keyboard resizing, saved widths and reset. Production chart alignment is being validated in the deployment-configs-homelab repository, using the CI-published immutable revision.
