# Enclave — Delivery tasks and acceptance plan

| Field | Value |
|---|---|
| Status | Draft v1.2, 2026-10-16; no implementation task is complete |
| Goal | Deliver a secure on-prem messenger for Android and web first, then iOS |
| Architecture | Spring Boot modules, PostgreSQL mailbox/outbox, Signal direct sessions, MLS groups, Flutter Android, React web, shared Rust protocol core subject to feasibility gates |
| Related | [Specs](specs.md), [ARF](arf.md), [UI](UI.md), [Mobile](mobile.md), [Sources](sources.md) |

This is a product delivery backlog, not a claim that the named files or build commands already exist. Each task names planned artifacts, dependencies, and measurable acceptance. Split a task into reviewable implementation issues when its interfaces are agreed; keep its ID in commits/issues and release evidence. All checkboxes remain open until the acceptance evidence exists. Implementation may use the available executing-plans workflow, but this document does not authorize unrelated deployment or messaging actions.

## 1. Release sequence and critical path

| Milestone | Outcome | Exit gate |
|---|---|---|
| M0 — prove the design | Android/browser crypto, storage, roles, dependency/license feasibility | FND-01/02/03; stop and revise ADRs if browser E2EE or group profile cannot be implemented safely |
| M1 — secure walking slice | Organization login, Android primary, web link, direct encrypted offline-capable exchange | ID-01/02, CORE-01/02, MSG-01/02, AND-01, WEB-01 |
| M2 — everyday messenger | 1v1 chats, managed groups, admin-posting communities, files/voice notes, shared pins, search, sync, direct calls | GRP-01/02/03, COM-01/02, FEAT-01/02, CALL-01, UI-01, AND-02, WEB-02 |
| M3 — Android/web production | Admin, privacy, load/failover, signed offline install/upgrade/restore, independent security review | ADM-01, OPS-01/02/03/04, SEC-01/02, REL-01 |
| M4 — later releases | iOS, group video/screen share, history transfer and richer features | Separate IOS-01/02, CALL-02, EXT-01/02/03 acceptance; no back-edge to M0–M3 |

Critical path: FND-02 → CORE-01/02 → ID-01/02 → MSG-01/02 → Android/web cross-client scenarios → groups/communities/features/direct calls → security/operations release evidence. UI exploration and platform provisioning may progress while protocol gates run, but use fixtures only until real interfaces are certified. Do not expand P0 with SFU group calls or iOS extension work.

### 1.1 Planned artifact ownership

| Path | Responsibility | First tasks |
|---|---|---|
| `proto/`, `contracts/openapi/` | Versioned wire/API schema and generated contracts | FND-01, ID-01, MSG-01 |
| `core/enclave-{core,proto,store,direct,group,browser,sim}/` | Shared protocol logic, native/browser persistence, simulator | FND-02, CORE-01/02, GRP-01/02/03 |
| `server/enclave-domain/`, `server/enclave-application/` | Framework-free model and transactional use cases | FND-03, ID-01, MSG-01 |
| `server/enclave-adapters-{in,out}/`, `server/enclave-boot-*/` | Ingress/infrastructure adapters and deployable profiles | FND-03, MSG-02, OPS-01 |
| `apps/enclave_app/`, `apps/android_native/` | Flutter Android and native adapters | AND-01/02, CALL-01 |
| `apps/web/`, `apps/admin_console/` | React web user/admin apps on separate origins | WEB-01/02, ADM-01 |
| `packages/design-tokens/` | Semantic colors/spacing/typography and UI fixtures | UI-01 |
| `tests/scenarios/`, `tests/security/`, `tests/load/` | Cross-client, adversarial, and capacity evidence | MSG-01 through REL-01 |
| `deploy/`, `tools/ops/`, `docs/runbooks/`, `docs/evidence/` | Reproducible installation, release/restore operations, proof | OPS-01/02/03/04, REL-01 |
| `apps/ios_extensions/` | Later Swift notification/local-push targets | IOS-01/02 only |

## 2. M0 — foundations and feasibility

### FND-01 — Requirements, contracts, and threat-model baseline

**Priority/owner:** P0, product + protocol + security leads. **Dependencies:** none.

**Artifacts:** `proto/enclave/{content,transport}/v1/`, `contracts/openapi/enclave-v1.yaml`, `docs/evidence/requirements-map.md`, updates to specs/ARF.

- [ ] Map every P0 requirement in specs §0 to task, API/event, UI journey, and verification scenario.
- [ ] Define canonical ID/encoding/domain-separation rules, reserved protobuf tags, unknown critical/noncritical feature behavior, error codes, and N/N−1 compatibility policy.
- [ ] Walk adversaries through first use, compromised IdP/server, linked-device compromise, browser malicious update, group/community-role misuse, parent-removal delegation, metadata correlation, and restore.
- [ ] Record accepted metadata, unavailable guarantees, independent review boundaries, and the provisional framework/protocol decisions.

**Done when:** Android, web, backend, and security owners can answer the same onboarding/send/revoke/recovery scenarios from the contracts without assuming missing services or server-held content keys.

### FND-02 — Prove Android/browser protocol and framework viability

**Priority/owner:** P0, client/protocol leads; highest-risk task. **Dependencies:** FND-01.

**Artifacts:** `core/enclave-direct/`, `core/enclave-group/`, `core/enclave-browser/`, `apps/enclave_app/`, `apps/web/`, `docs/evidence/client-feasibility.md`, locked dependency/toolchain files.

- [ ] Build the selected libsignal/OpenMLS profiles on physical Android and supported Chromium/Firefox worker environments; record exact revisions, license inventory, patch ownership, and upstream support limits.
- [ ] Exchange direct and group ciphertext Android↔browser, persist sessions, restart both, then decrypt the next message; exercise random generation and malformed-input rejection.
- [ ] Prove application-profile feasibility with an authorized/forbidden role-transition vector, parent-revocation/link-proof feasibility, and external-join-or-Add/Welcome prototype; obtain an early independent composition review before M0 exit. GRP-01 and COM-01 supply the complete production implementation/review later.
- [ ] Measure bridge payload/copy costs, worker startup, browser memory, persistent encrypted-store behavior, Android keystore wrapping, and browser passphrase unlock.
- [ ] Prototype direct WebRTC with encrypted signaling and TURN fallback on Android/web; validate required browser/media capabilities.
- [ ] Evaluate Flutter Android vs KMP mobile integration against the criteria in mobile §2; choose one, retain the same protocol contracts, and record the decision.
- [ ] Obtain qualified distribution/license assessment; if browser crypto or licensing fails, publish a superseding ADR with a reviewed protocol/portability choice before building dependent production code.

**Done when:** repeatable native/browser build and cross-decryption evidence exists for the pinned set. No backend decryption, unreviewed crypto replacement, unsupported “WASM should work” assertion, or iOS task can satisfy this gate.

### FND-03 — Repository, CI, local services, and module skeleton

**Priority/owner:** P0, backend/platform leads. **Dependencies:** FND-01; production dependency pins from FND-02.

**Artifacts:** `server/`, `core/Cargo.toml`, `deploy/dev/compose.yaml`, CI workflows, `docs/development.md`, release BOM.

- [ ] Create the documented Gradle/Rust/app structure and reproducible local PostgreSQL/Valkey/IdP/object-store/TURN setup with test-only identity and keys.
- [ ] Enforce module boundaries with ArchUnit, generate schema bindings deterministically, and document actual boot/build/check commands once runnable.
- [ ] Add locked dependencies, secret/dependency/license scanning, SBOM/provenance, isolated signing paths, and redacted CI logs.
- [ ] Prove clean-checkout builds and an offline dependency mirror; separate unit tests from infrastructure scenarios.

**Done when:** a fresh developer can build the chosen clients and services using the documented commands; no application or pipeline artifact contains production credentials.

## 3. M1 — identity, core, and secure direct messaging

### CORE-01 — Native/browser transactional protocol storage

**Priority/owner:** P0, core lead. **Dependencies:** FND-02/03.

**Artifacts:** `core/enclave-store/`, `core/enclave-browser/`, transaction/concurrency fixtures in `core/enclave-sim/`.

- [ ] Implement native SQLCipher and browser encrypted-record adapters behind a typed storage boundary; encrypt local search material and exclude plaintext caches/backups.
- [ ] Serialize protocol writers: native background/UI coordination and browser worker/tab leases with fencing.
- [ ] Atomically persist decrypt + protocol advancement + message/index + processed marker before ack; persist outgoing ciphertext + state before network send.
- [ ] Inject process termination, quota/low-disk failures, lock contention, tab races, key invalidation, and migration interruption at transaction boundaries.

**Done when:** the next message decrypts after every supported crash/restart; no premature ack, duplicate message rendering, or protocol-state/nonce rollback occurs.

### CORE-02 — Protocol facade and state/error model

**Priority/owner:** P0, core/client leads. **Dependencies:** CORE-01, FND-01.

**Artifacts:** `core/enclave-core/`, native/browser generated facades, core contract fixtures.

- [ ] Implement typed registration/link/send/process/verify/lock/group/community commands and observable conversation/outbox/call state.
- [ ] Bound parsers and FFI buffer ownership; sanitize error values and prohibit raw key/payload logging.
- [ ] Define unknown content handling and bounded encrypted quarantine/recovery for poison envelopes.

**Done when:** Flutter and React consume the same domain contracts and fixtures without implementing independent cryptography or direct protocol-table mutation.

### ID-01 — Organization bootstrap, SSO, devices, and prekeys

**Priority/owner:** P0, identity/backend lead. **Dependencies:** FND-01/03, CORE-02.

**Artifacts:** identity/device use cases and adapters, Flyway migrations, OpenAPI enrollment/key endpoints, OIDC test scenarios.

- [ ] Map `(issuer, sub)` to app IDs; implement trusted deployment config, PKCE, reservations, signed address bindings, device limits, credential hashing/rotation, and first-device atomic registration.
- [ ] Claim prekeys/KeyPackages once under concurrency; expire/replenish without assumed last-resort MLS reuse.
- [ ] Restrict REST scopes and browser tickets; enforce authoritative active-device/account checks and exact `Origin`/CORS rules.

**Done when:** duplicate enrollment and key claims cannot create/reuse addresses or one-time keys; invalid issuer/audience, stale challenges, and cross-account access are rejected with stable errors.

### ID-02 — Link, revoke, reset, and lifecycle reconciliation

**Priority/owner:** P0, identity/client leads. **Dependencies:** ID-01, CORE-01/02.

**Artifacts:** provisioning relay/storage, device lifecycle use cases, Android/web link UI, `tests/scenarios/device-lifecycle/`.

- [ ] Implement QR transcript binding, trusted-device approval, one-use session/code consumption, expiry, safe cancellation, and encrypted current-state sync without historical ratchet transfer.
- [ ] Implement own-device notices, monotonic list versions, peer identity checks, admin disable intake/retry/dedupe/reconciliation, and durable control events.
- [ ] Revoke server access on commit, close sockets within 60 s, gate affected groups, and attempt honest-client local cleanup; require explicit IK-reset re-verification.

**Done when:** swapped/replayed QR sessions fail; an unapproved IdP login cannot link a device; revoked devices fail new requests and do not receive new fan-out; reset never restores old plaintext by itself.

### MSG-01 — Mailboxes, idempotent submits, and reconnect

**Priority/owner:** P0, messaging lead. **Dependencies:** ID-01, CORE-01/02.

**Artifacts:** send/ack/drain use cases, protobuf transport, mailbox/submission migrations, `tests/scenarios/delivery/`.

- [ ] Implement per-device fan-out, roster-version rejection, submission digest/result dedupe, stable pagination, ack scoping, expiry, size/quota admission, and client durable outbox states.
- [ ] Recover lost send responses with the same stored ciphertext/submission ID; preserve semantic message ID on explicit re-encryption.
- [ ] Implement connection backoff, bounded drains/writes, keepalive mailbox safety net, and stale/duplicate envelope handling.

**Done when:** a lost response or pod kill produces one visible content item, no accepted-envelope loss in the certified HA failure model, and no cross-device ack/delete. Offline reconnect drains in bounded batches.

### MSG-02 — Durable wake-up and control dispatch

**Priority/owner:** P0, backend/platform leads. **Dependencies:** MSG-01, ID-02.

**Artifacts:** outbox migrations/leases, push adapters, optional Valkey hints, provider simulator, failure scenarios.

- [ ] Commit wake intents with envelopes, lease/retry via primary polling, bound TTL/dead letters, and separate message/call/security kinds.
- [ ] Certify UnifiedPush and optional FCM; enforce push URL allowlists/SSRF defenses and content-free payloads.
- [ ] Implement token-generation freshness, compare-and-delete invalidation, successful-attempt coalescing, and duplicate event rendering protection.
- [ ] Kill after commit/before hint, before provider call, and after provider acceptance; lose all Valkey state and simulate replica lag/token replacement.

**Done when:** eligible intents recover without a client reconnect; duplicate attempts remain safe; a rejected old token never deletes a replacement; metrics distinguish provider acceptance from device delivery.

### AND-01 — Android walking slice

**Priority/owner:** P0, Android lead. **Dependencies:** UI-01 initial tokens/flows, CORE-02, ID-01/02, MSG-01/02.

**Artifacts:** `apps/enclave_app/`, `apps/android_native/{keystore,notifications,delivery}/`, physical-device evidence.

- [ ] Deliver organization/SSO/first-device, scan-to-link-web, chat list/thread/composer, lock, send/receive/offline status, and generic notifications.
- [ ] Implement permission denial paths, encrypted DB migration, backup exclusion, token rotation, and process-death recovery.
- [ ] Exercise active/background/Doze/force-stop/restricted-battery/LAN/VPN cases and clearly label unsupported wake conditions.

**Done when:** a real Android device registers, links a browser, and exchanges persistent encrypted messages through offline/restart with no sensitive logs or default plaintext previews.

### WEB-01 — Browser walking slice and trust controls

**Priority/owner:** P0, web lead. **Dependencies:** UI-01 initial flows, CORE-02, ID-01/02, MSG-01/02.

**Artifacts:** `apps/web/`, worker/storage integration, static-host/CSP config, `tests/scenarios/browser/`.

- [ ] Deliver organization/SSO/browser-primary enrollment and linking, responsive chat UI, passphrase lock, local encrypted store, bounded cross-tab coordination, and one-use WebSocket tickets.
- [ ] Implement strict CSP/Origins/CORS, bundled assets, safe message rendering, redacted headers, update compatibility, and accurate browser trust text.
- [ ] Test private browsing, quota/eviction/cleared storage, worker restart, two-tab races, offline reopen, and supported Chromium/Firefox versions.

**Done when:** browser-primary registration works without an Android prerequisite, browser↔Android exchange survives storage/worker restarts where persistence is supported; lost storage prompts re-link; no backend plaintext fallback or long-lived URL credential exists.

## 4. M2 — groups and everyday features

### UI-01 — Shared interaction/design system and accessibility

**Priority/owner:** P0, design + Android/web leads. **Dependencies:** FND-01; starts during M0.

**Artifacts:** `packages/design-tokens/`, Android/web scenario fixtures, `docs/evidence/ui-acceptance.md`.

- [ ] Build compact/wide, light/dark prototypes for account/community onboarding, announcement acknowledgement, linking, thread/composer, groups, call, settings, and security/recovery states from UI.md.
- [ ] Implement semantic labels/focus, contrast, target sizing, dynamic text, reduced motion, English/Romanian catalogs, and safe IME behavior.
- [ ] Test keyboard-only, TalkBack, web screen readers, 200% zoom, slow/offline first use, and friendly error comprehension.

**Done when:** Android and web independently meet the P0 journeys and measured usability/accessibility targets; visual screenshots are supplemented by interaction evidence.

### GRP-01 — Reviewed MLS application profile and authorization

**Priority/owner:** P0, protocol/security leads. **Dependencies:** FND-02, ID-01/02, CORE-02.

**Artifacts:** `core/enclave-group/`, versioned credential/role extension profile and vectors, public-parser adapter contract.

- [ ] Specify and implement authenticated role state, device binding, required capabilities, authorized Add/Remove/promote/demote/leave/transfer, moderation/posting/invite policy, and external-join semantics.
- [ ] Separate DS public validation from member-only membership/confirmation validation; reject malformed/unauthorized transitions on clients.
- [ ] Demonstrate malicious server ACL changes cannot authorize membership, and delegated revocation rules are explicit.

**Done when:** independent protocol review approves the profile and Android/browser vectors match. Unproven external-commit semantics use a documented authorized Add/Welcome fallback before shipping.

### GRP-02 — Ordered groups, commit acceptance, and catch-up

**Priority/owner:** P0, group backend/core leads. **Dependencies:** GRP-01, MSG-01/02.

**Artifacts:** group migrations/API, `group_events`, client sequencing/pending-commit code, simulator scenarios.

- [ ] Persist roster/epoch/role changes, commit ID/digest, group sequence, Welcome fan-out, and intents atomically under lock/CAS.
- [ ] Resolve lost acceptance by commit lookup; dedupe sender echo; interleave applications/commits without processing applications before required commits.
- [ ] Retain bounded catch-up events, expire old receive secrets, and provide explicit out-of-window rejoin/fork recovery.

**Done when:** concurrent commits, lost responses, offline members, add/remove/link/revoke, and restored-server-ahead-client scenarios cannot silently fork accepted roles or expose post-removal new-epoch content.

### GRP-03 — Group UI, limits, and adversarial scale

**Priority/owner:** P0, Android/web + QA leads. **Dependencies:** GRP-02, UI-01.

**Artifacts:** group UI in both clients, `core/enclave-sim/`, `tests/load/groups/`.

- [ ] Implement create/add/remove/promote-to-admin/demote/leave/accepted-owner-transfer, encrypted metadata, posting mode, scoped invite links/join approval/bans, shared pins, timer, guest indicator, and rekey/rejoin states.
- [ ] Exercise 1,000-account / 5,000-leaf interactive target with roster churn, offline catch-up, and bounded commit/parser memory.
- [ ] Record measured limits and lower advertised capacity if the target fails; test unavailable key packages and no-final-owner-removal, admin-peer protection, role demotion during queued sends, and banned-member rejoin denial.

**Done when:** user-visible role/member state derives from accepted authenticated group state and advertised sizes have reproducible evidence.

### COM-01 — Community domain and authenticated linkage

**Priority/owner:** P0, protocol/backend/security leads. **Dependencies:** GRP-01/02, ID-02.

**Artifacts:** community application module, root/subgroup profile extensions and vectors, community/link/operation migrations and OpenAPI contracts, `docs/evidence/community-profile.md`.

- [ ] Implement community/root IDs, owner/admin/member roles, admin-only announcement events, revision-bound explicit announcement/rules responses, versioned onboarding packages, separately encrypted subgroups, link visibility, and approved join/invite lifecycles from specs §30.
- [ ] Require two-sided group-link authority and explicit root enrollment; implement narrow authenticated parent-removal delegation without granting subgroup read/admin powers.
- [ ] Define replay-safe cross-group proof/version checks, owner-transfer prerequisites, idempotent pending operation state, and affected-space send gates.
- [ ] Review audience-scoped E2EE private-link descriptor distribution and authority proofs; a full link descriptor in root-shared state or UI-only filtering does not meet privacy requirements. Record unavoidable backend relationship metadata and any intentionally shared management labels.
- [ ] Define reviewer-scoped pairwise response routing (maximum 10 reviewers), eligibility/revision checks, account dedupe, retained response expiry, and private own-device checklist state; no plaintext server reports or response broadcast to the root feed.
- [ ] Extend independent protocol review to subgroup isolation, malicious parent/server role claims, partial membership transitions, acknowledgement confidentiality, and private subgroup recommendations.

**Done when:** members cannot post in the announcement feed or gain content through forged links; community admins outside a subgroup cannot read it; a valid parent removal authorizes only the delegated removal, never new readers or promotion.

### COM-02 — Android/web communities and partial-removal recovery

**Priority/owner:** P0, Android/web/core + QA leads. **Dependencies:** COM-01, GRP-03, MSG-02, FEAT-02, UI-01.

**Artifacts:** Communities navigation/detail/feed/manage flows in both clients, community simulator/failure scenarios, `tests/scenarios/communities/`.

- [ ] Deliver create/join/approve, admin announcements, linked-group discovery/join, admin promotion/owner demotion, shared pins/rules, mute, and explicit leave/removal progress.
- [ ] Deliver optional announcement acknowledgement with named-reviewer reports and private welcome/rules/recommended-group/checklist flows from specs §30.6–30.7. Keep read receipts, personal checklist progress, and explicit shared responses distinct.
- [ ] Test disabled read receipts, offline/two-device duplicate responses, edited/deleted announcements, rules/reviewer revisions, reviewer demotion, expired/removed members, changed checklist items, and hidden/ineligible recommendations.
- [ ] Enforce permitted reaction/control/acknowledgement events without allowing a member to disguise a post; preserve protocol maintenance in read-only feeds.
- [ ] Race link/unlink/removal/role change and disconnect an authorized subgroup committer; resume idempotently after restart/restore with no false “removed everywhere” state.
- [ ] Benchmark 1,000 community accounts / 5,000 root devices / 20 linked groups with realistic subgroup fan-out and churn; record lower certified limits if necessary.

**Done when:** every specs §30.5–30.7 scenario passes across Android/web, including private-subgroup discovery isolation, rejected multiple-parent/nested-root links, scoped private-link descriptors, no automatic old-history exposure, and no new-epoch content after accepted removal. iOS and SFU are not prerequisites.

### FEAT-01 — Attachments, photos, and voice notes

**Priority/owner:** P0, core/client/backend leads. **Dependencies:** MSG-01, CORE-01/02, UI-01.

**Artifacts:** reviewed attachment format/vectors, object-store adapter/presigning, media/voice-note UI in Android/web.

- [ ] Implement fresh stream keys, authenticated finality/order/length, resumable local ciphertext retries, encrypted pointers/thumbnails/waveforms, digest/tag verification, and bounded caches.
- [ ] Implement file/photo pickers, paste/drop, cancellation, permission denial, EXIF default stripping, playback, and explicit external open/share.
- [ ] Reject truncation/reordering/tag failure/counter overflow/MIME mismatch/oversized decoders; test missing/expired objects and quota failure.

**Done when:** Android/web can exchange valid files/voice notes without server plaintext and neither opens unverified content. P1 multipart upload is optional.

### FEAT-02 — Mutations, sync, privacy, local search

**Priority/owner:** P0, core + Android/web leads. **Dependencies:** MSG-01, GRP-02, FEAT-01.

**Artifacts:** versioned encrypted events, local index/mutation store, conversation/settings UI, state-convergence scenarios.

- [ ] Implement replies, mentions, author edits/deletes and role-authorized moderation deletes, reactions, Note to self, safe basic formatting, shared message pins versus private chat pins/bookmarks, explicit forwarding, message requests/blocking, drafts, mute/archive/unread, read/delivery preferences, and bounded typing.
- [ ] Sync own-device settings/read cursors with deterministic counters; validate authors/roles and mutations arriving before targets.
- [ ] Expire content/index/keys/previews/notifications and prevent late resurrection via tombstones; implement local message/file search with Romanian diacritic handling.

**Done when:** concurrent Android/browser actions converge; invalid-author edits and unauthorized moderation cannot mutate other content; pins/forwards cannot resurrect deleted content or silently expose old content to new members; expiry leaves no app-accessible plaintext/search/preview material outside documented OS limitations.

### CALL-01 — Android/web direct audio and video

**Priority/owner:** P0, media + Android/web leads. **Dependencies:** FND-02 media proof, ID-02, MSG-02, CORE-02, UI-01.

**Artifacts:** encrypted call state/signaling, TURN issuer/config, Android Telecom adapter, browser WebRTC integration, call scenario suite.

- [ ] Implement authenticated offer/answer/ICE generations, 60 s TTL, first-answer arbitration, ended-call dedupe, explicit permissions, and relay policy.
- [ ] Implement native audio routes/focus/locked-screen behavior and browser active-session incoming UI; handle glare without auto-answer.
- [ ] Test network handover/ICE restart, blocked UDP/TURN TLS, delayed/cancelled offers, duplicate wakes, denied permissions, and no plaintext signaling fallback.

**Done when:** Android↔web calls work in certified networks, late offers never ring, camera/microphone activate only on explicit permitted actions, and revoked identities cannot start new calls.

### AND-02 / WEB-02 — Complete platform integration and parity

**Priority/owner:** P0, respective client leads. **Dependencies:** AND-01/WEB-01, GRP-03, COM-02, FEAT-01/02, CALL-01, UI-01.

**Artifacts:** complete Android/web flows, platform-specific diagnostics, `tests/scenarios/parity/`.

- [ ] Complete storage/preferences/devices/verification/search/call UI, errors, policy-managed controls, and local-data clearing.
- [ ] Execute the Android↔web matrix in mobile §8 and UI degraded-state matrix on physical Android and supported browsers.
- [ ] Record startup/memory/list-scroll/attachment resource results and fix accessibility/localization failures, including admin-only feed and role-change accessibility.

**Done when:** both clients satisfy every P0 UI feature with real backend/core behavior; no mock button or iOS-dependent implementation remains on the P0 path.

## 5. M3 — administration, operations, and release

### ADM-01 — Administration, signed policy, and audit

**Priority/owner:** P0, admin/security leads. **Dependencies:** ID-02, GRP-02, MSG-02.

**Artifacts:** `apps/admin_console/`, policy/admin endpoints, serialized audit append/checkpoint/export.

- [ ] Implement scoped roles, separate origin, SSO/step-up, bounded user/device support, policy version/conflict handling, and aggregate health.
- [ ] Audit sensitive actions/denials/exports with reason fields; sign/export chain heads to an independent append-only destination.
- [ ] Validate policies against capabilities and distinguish client governance from cryptographic guarantees.

**Done when:** least-privilege tests pass, privileged database rewrite is detectable after an independent checkpoint, and no admin flow reads chat content or silently adds an archive participant.

### OPS-01 — Certified deployment, networking, and offline install

**Priority/owner:** P0, platform lead. **Dependencies:** FND-03, MSG-02, CALL-01, GRP-02/03, COM-02.

**Artifacts:** `deploy/charts/enclave/`, `deploy/airgap/`, network/port matrix, `docs/runbooks/install.md`.

- [ ] Package small/medium and connected/restricted overlays; configure primary/replica poolers, sync quorum, default-deny traffic, separate DB roles, object endpoints, private DNS/NTP/CA, and TURN ports.
- [ ] Use supported CNI/host firewall controls for media; test client access to presigned URLs and all discovery endpoints.
- [ ] Build signed fully offline bundles/assets/dependencies and prove no public fonts/CDN/STUN/license/update requests at runtime.

**Done when:** a clean customer-like restricted network installs and runs Android/web direct/group chat and direct calls using the documented prerequisites.

### OPS-02 — Capacity, observability, and failure recovery

**Priority/owner:** P0, platform + QA leads. **Dependencies:** MSG-02, GRP-03, CALL-01, OPS-01.

**Artifacts:** dashboards/alerts, `tests/load/`, sanitized load/chaos evidence.

- [ ] Measure the 20k-socket medium baseline with documented direct/group/community/attachment mix; separate 10M-envelope/day stress tests from normal sizing.
- [ ] Instrument API/drain/ack, oldest outbox intent, leases/retries, replica lag, queue bytes, key health, revoke latency, and provider/device outcomes without payloads or stable personal identifiers.
- [ ] Fail gateway, worker, Valkey, and PostgreSQL primary; demonstrate HA durability, bounded overload, reconnect recovery, and independent worker polling.

**Done when:** advertised SLO/limits have workload-specific results and dashboards/runbooks explain both successful recovery and remaining failure boundaries.

### OPS-03 — Signed upgrades, compatibility, and trust rotation

**Priority/owner:** P0, release/platform/client leads. **Dependencies:** OPS-01, ADM-01, AND-02/WEB-02.

**Artifacts:** signed release/BOM pipeline, migration orchestration, `docs/runbooks/upgrade.md`, compatibility fixtures.

- [ ] Test ArgoCD phase/wave ordering with bootstrap prerequisites and a migration Job health gate; avoid a PreSync-before-data deadlock.
- [ ] Implement expand/migrate/contract schema changes, gateway drain, N/N−1 protocols, native/browser update policy, and tested rollback constraints.
- [ ] Rotate current/next native pins and signing keys without bypasses; test private browser CA trust, ticket expiry, and web asset cache updates.

**Done when:** an old/new rolling release and certificate change preserve encrypted drafts/state and rejected unsupported clients receive a safe update path.

### OPS-04 — Backup, safe restore, and incident runbooks

**Priority/owner:** P0, platform/security leads. **Dependencies:** OPS-01/03, ID-02, GRP-02, COM-02.

**Artifacts:** `docs/runbooks/{restore,incident}.md`, backup/fencing tooling, quarterly restore evidence.

- [ ] Back up/test restore of data, objects, IdP, and server secrets; protect lifecycle/checkpoint/restore-generation evidence outside rollback scope.
- [ ] Restore snapshots predating revocation, prekey consumption, key rotation, and group commits and partially completed community removals; reconcile/expire/quarantine before opening traffic.
- [ ] Measure RPO/RTO and communicate potentially lost ciphertext/object ranges; never pick a trusted MLS branch by highest epoch alone.

**Done when:** a revoked device cannot regain access after restore, consumed key material is not reused, unsafe groups fail closed, and Android/web can recover through explicit trusted actions.

### SEC-01 / SEC-02 — Security verification and independent review

**Priority/owner:** P0, security lead + independent reviewer. **Dependencies:** secure walking slice for early review; all P0 modules for release assessment.

**Artifacts:** fuzz/security scenarios, privacy captures, threat-model revisions, audit report and remediation evidence.

- [ ] SEC-01: fuzz protocol/media/QR parsers, verify object/credential/role authorization, exercise replay/key-substitution/SSRF/XSS/CORS/browser-ticket abuse, and scan artifacts/dependencies/secrets.
- [ ] SEC-01: inspect backend DBs/objects/pushes/traces/logs/media captures and Android/browser caches/backups for forbidden plaintext/keys; verify stated metadata retention.
- [ ] SEC-02: independently review cryptographic composition, MLS role/recovery profile, provisioning, shared-IK implications, web trust, and deployment/restore behavior.
- [ ] Resolve all critical/high findings; assign owners/evidence for lower residual risks and update user-facing guarantees.

**Done when:** release claims are supported by repeatable checks and external review; “uses Signal” is never treated as sufficient assurance.

### REL-01 — Android/web GA readiness

**Priority/owner:** P0, product + QA + operations + security. **Dependencies:** all preceding P0 tasks, including SEC-01/02.

**Artifacts:** `docs/evidence/ga-readiness.md`, signed Android/web/backend release, release notes, support/runbook links.

- [ ] Assemble requirement coverage, device/browser/profile matrix, accessibility/usability evidence, load/chaos/restore results, audit remediation, license/support findings, and rollback instructions.
- [ ] Run clean-install → Android registration → web link (also browser-primary → Android link) → offline direct/group/community exchange → add/remove/promote/demote/join approval → community removal recovery → file/voice → search → identity change → revoke → direct call → signed upgrade acceptance.
- [ ] Publish exact supported platforms/versions, capacity, metadata/notification limits, and deferred P1/P2 features without claiming implementation of the roadmap.

**Done when:** named release owners approve documented evidence and there are no open P0 tasks or undisclosed critical/high defects. iOS and group video remain separately scheduled.

## 6. P1/P2 — later work, never a P0 prerequisite

| ID | Priority | Deliverable / planned artifacts | Depends on | Acceptance |
|---|---|---|---|---|
| IOS-01 | P1 | Entitlement/distribution and Swift/Rust extension spike; `apps/ios_extensions/`, physical-device evidence | REL-01, CORE-02 | APNs/NSE/PushKit/CallKit and local SSID-push feasibility demonstrated with signed builds; unsupported profiles explicit. |
| IOS-02 | P1 | Flutter iOS app, Keychain/App Group concurrency, native lifecycle/accessibility | IOS-01 | Mobile §10/11 matrix passes with existing Android/web; no separate protocol fork. |
| CALL-02 | P1 | Self-hosted LiveKit group video, screen share, removal rotation, participant binding | REL-01, GRP-02 | 50-participant target benchmarked; captured SFU media unreadable; removal pauses old-key publication; key-slot wrap/rejoin safe. |
| EXT-01 | P1 | Polls/quizzes, community events/RSVP, stickers/approved GIFs, optional local-only transcription, guest invites, user-selected abuse evidence | REL-01, FEAT-02 | Specs §25 semantics, explicit destination/privacy behavior, and abuse/expiry cases covered on Android/web. |
| EXT-03 | P1 | Topics/threads, private folders, quiet/scheduled sends/reminders, view-once media, custom admin grants/member restrictions/slow mode | REL-01, FEAT-02, COM-02 | Specs §30.4 permissions/retention apply; view-once is not screenshot-proof, topics do not create private audiences, scheduling needs an online device. |
| EXT-02 | P1 | Approved encrypted history transfer, optional multipart attachment upload | REL-01, FEAT-01/02 | Historical content transfer cannot restore live ratchet state or fire old calls/notifications. |
| PRIV-01 | P1 | Separate sealed-sender REST transport and abuse controls | REL-01, SEC-02 | No authenticated-socket anonymity claim; recipient/certificate/rate-limit/replay tests and metadata review pass. |
| WEB-03 | P1 | Safari certification and optional connected-profile Web Push | REL-01, WEB-02 | Actual worker/storage/media support matrix; provider egress/consent/privacy policy explicit. |
| TRUST-01 | P2 | Independent key transparency and auditor/witness deployment | REL-01, SEC-02 | Inclusion/consistency/split-view tests; no replacement of out-of-band verification by untrusted server signature. |
| BACKUP-01 | P2 | Recovery-key encrypted backup with reviewed restore semantics | OPS-04, SEC-02 | No server recovery key; no stale ratchet/MLS state reuse; loss and recovery UX tested. |
| ARCHIVE-01 | P2 | Visible archive/bot participants with separate recipient trust boundary | GRP-01, SEC-02 | Explicit membership/consent banner and role audit; no invisible 1:1 interception. |
| FED-01 | P2 | Cross-deployment identity/routing/protocol research and ADR | REL-01 | Written threat/metadata/namespace/revocation model before implementation. |
| PQ-01 | P2 | Reviewed supported PQ MLS profile | GRP-01, FND-02 | Negotiated version/ciphersuite and interoperable vectors; no unstandardized silent upgrade. |
| DESK-01 | P2 | Signed native desktop packaging | REL-01 | Native keystore/update/trust model certified separately from web. |

## 7. Definition of done and scope discipline

A completed implementation issue includes its exact changed paths, contract/schema change, relevant behavioral/failure evidence, privacy implications, and docs/diagram updates. Tests must demonstrate meaningful protocol/user invariants; avoid snapshotting implementation details or re-running unrelated suites without a reason. A passing happy-path demo does not close a security/reliability task.

Keep prerequisites acyclic. Update the requirement-to-task map when scope changes. Commit coherent reviewed slices and push checkpoints to the configured GitHub repository; never include private keys, tokens, payload-bearing traces, generated local databases, or production configuration in commits. Do not mark a milestone complete because only its documentation exists.
