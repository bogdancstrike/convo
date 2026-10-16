# Enclave — Delivery tasks and acceptance plan

| Field | Value |
|---|---|
| Status | Draft v1.3, 2026-10-17; no implementation task is complete |
| Goal | Deliver every advertised feature at Android/web launch; iOS is a separate client target |
| Architecture | Spring Modulith, verified feature-module boundaries, PostgreSQL mailbox/outbox, Signal direct sessions, MLS groups, Flutter Android, React web, shared Rust protocol core subject to feasibility gates |
| Related | [Specs](specs.md), [ARF](arf.md), [UI](UI.md), [Mobile](mobile.md), [Sources](sources.md) |

This is a product delivery backlog, not a claim that the named files or build commands already exist. Each task names planned artifacts, dependencies, and measurable acceptance. Split a task into reviewable implementation issues when its interfaces are agreed; keep its ID in commits/issues and release evidence. All checkboxes remain open until the acceptance evidence exists. Implementation may use the available executing-plans workflow, but this document does not authorize unrelated deployment or messaging actions.

## 1. Release sequence and critical path

| Milestone | Outcome | Exit gate |
|---|---|---|
| M0 — prove the design | Native/browser crypto, passwordless/2FA, Modulith boundaries and all launch extension feasibility | FND-01/02/03; resolve protocol/license/extension risks before dependent implementation |
| M1 — secure walking slice | Organization login, Android primary, web link, direct encrypted offline-capable exchange | ID-01/02, CORE-01/02, MSG-01/02, AND-01, WEB-01 |
| M2 — full product implementation | Every messaging, community, media, collaboration, privacy/recovery, federation and integration feature | All feature tasks in §3/4/6; no advertised feature is postponed |
| M3 — complete launch qualification | Full feature catalogue, admin/ops, load/failure, independent review, signed offline delivery | ADM-01, OPS-01/02/03/04, SEC-01/02, REL-01; §31 coverage is mandatory |
| Client follow-on | iOS and native desktop certification using the complete feature/protocol contracts | IOS-01/02, DESK-01; separate client gate under the current Android/web scope |

These are internal build milestones, not partial feature releases. Every feature task below is a launch prerequisite unless explicitly identified as a client-platform follow-on. Optional means policy/user opt-in at launch. Unresolved feasibility is a blocker, never a silent deferral.

Critical path: FND-02 → CORE-01/02 → ID-01/02 → MSG-01/02 → Android/web exchange → complete groups/communities/media/collaboration/trust/recovery/federation → security/operations evidence → REL-01. UI work and infrastructure preparation may proceed in parallel with protocol proof. Resolve the PQ MLS/federation/local model feasibility gates early; do not defer their design until production readiness.

### 1.1 Planned artifact ownership

| Path | Responsibility | First tasks |
|---|---|---|
| `proto/`, `contracts/openapi/` | Versioned wire/API schema and generated contracts | FND-01, ID-01, MSG-01 |
| `core/enclave-{core,proto,store,direct,group,browser,sim}/` | Shared protocol logic, native/browser persistence, simulator | FND-02, CORE-01/02, GRP-01/02/03 |
| `server/enclave-modules/<feature>/{api,internal}/` | Named APIs/events and owned domain/use cases/persistence | FND-03, ID-01, MSG-01 |
| `server/enclave-boot-all/`, `server/enclave-contracts/` | Spring Modulith runtime, narrow shared IDs and event contracts | FND-03, MSG-02, OPS-01 |
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

- [ ] Map every README bullet, specs §0 FR/NFR and §31 launch AC to task, API/event, UI journey and real automated/manual verification. CI rejects missing, duplicated or deferred coverage.
- [ ] Define canonical ID/encoding/domain-separation rules, typed safe rich descriptions and ordered photo-album metadata/captions, reserved protobuf tags, unknown critical/noncritical feature behavior, error codes, and N/N−1 compatibility policy.
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
- [ ] Produce named feasibility artifacts for Keycloak passwordless + optional/enforced TOTP (including combined paths), device PoP/canonicalization, PQ MLS suite/implementation availability, two-deployment federation identity/routing and offline native/browser local models. Each records a runnable spike, pinned dependencies, failure cases, resource budget and a proceed/revise decision; later workstreams still implement/review the production behavior.
- [ ] Obtain qualified distribution/license assessment; if browser crypto or licensing fails, publish a superseding ADR with a reviewed protocol/portability choice before building dependent production code.

**Done when:** repeatable native/browser build/cross-decryption and all named launch-extension feasibility decisions exist for the pinned set. An unresolved PQ, federation, proof-of-possession, authentication-flow or local-model feasibility failure blocks M0 rather than silently deferring the capability. No backend decryption, unreviewed crypto replacement, unsupported “WASM should work” assertion, or iOS task can satisfy this gate.

### FND-03 — Repository, CI, local services, and module skeleton

**Priority/owner:** P0, backend/platform leads. **Dependencies:** FND-01; production dependency pins from FND-02.

**Artifacts:** `server/enclave-modules/`, `server/enclave-boot-all/`, `core/Cargo.toml`, `deploy/dev/compose.yaml`, CI workflows, `docs/development.md`, release BOM.

- [ ] Create the documented Gradle/Rust/app structure and reproducible local PostgreSQL/Valkey/IdP/object-store/TURN setup with test-only identity and keys.
- [ ] Enforce Spring Modulith `ApplicationModules.verify()` and ArchUnit rules; use named interfaces, module-owned tables, persistent event publication and scoped module/Scenario tests. Generate module docs and deterministic contracts; record real build/test commands once runnable. Demonstrate failed boundary violations and idempotent listener recovery (AC-ARCH-01/02).
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

**Artifacts:** sanitized Keycloak realm/client exports and auth journey fixtures, identity/device use cases and adapters, Flyway migrations, OpenAPI enrollment/key endpoints, OIDC test scenarios.

- [ ] Deliver Keycloak passwordless/passkey choice and Google Authenticator-compatible TOTP enrollment, combined optional/enforced flows, safe credential changes and recovery; export sanitized realm/client policy fixtures and prove AC-ID-01–05.
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

**Artifacts:** messaging module send/ack/drain APIs, owned persistence and versioned events, protobuf transport, mailbox/submission migrations, `tests/scenarios/delivery/`.

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

- [ ] Implement create/add/remove/promote-to-admin/demote/leave/accepted-owner-transfer, rich encrypted descriptions and searchable account-level member lists/admin filters, posting mode, scoped invite links/join approval/bans, shared pins, timer, guest indicator, and rekey/rejoin states.
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
- [ ] Implement ordered 2–10-photo albums with stable item IDs, album/per-photo captions, grid/viewer, atomic logical publication after retained uploads succeed, resumable stored ciphertext and expiry/unavailable-slot handling.
- [ ] Reject truncation/reordering/tag failure/counter overflow/MIME mismatch/oversized decoders; test missing/expired objects and quota failure.

**Done when:** Android/web can exchange valid files/voice notes without server plaintext and neither opens unverified content. Multipart upload is an optional configuration delivered and tested at launch (AC-MED-07).

### FEAT-02 — Mutations, sync, privacy, local search

**Priority/owner:** P0, core + Android/web leads. **Dependencies:** MSG-01, GRP-02, FEAT-01.

**Artifacts:** versioned encrypted events, local index/mutation store, conversation/settings UI, state-convergence scenarios.

- [ ] Implement replies, mentions, author edits/deletes and role-authorized moderation deletes, reactions, Note to self, safe basic formatting, shared message pins versus private chat pins/bookmarks, explicit forwarding, message requests/blocking, drafts, mute/archive/unread, read/delivery preferences, and bounded typing.
- [ ] Sync own-device settings/read cursors with deterministic counters; validate authors/roles and mutations arriving before targets.
- [ ] Implement mentions-only alert filtering after local verification and timed snooze as a deadline overlay restoring All/Mentions only/Muted; test locked processing, stale sync, restart, DST/time-zone changes and no backlog alert flood.
- [ ] Implement up-to-100-message batch copy/one-destination forward/save/delete with per-item authorization/expiry, confirmation, rate limits, idempotent retries and explicit partial outcomes.
- [ ] Expire content/index/keys/previews/notifications and prevent late resurrection via tombstones; implement local message/file search with Romanian diacritic handling.

**Done when:** concurrent Android/browser actions converge; invalid-author edits and unauthorized moderation cannot mutate other content; pins/forwards cannot resurrect deleted content or silently expose old content to new members; expiry leaves no app-accessible plaintext/search/preview material outside documented OS limitations.

### FEAT-03 — Everyday chat presentation, discovery, and navigation

**Priority/owner:** P0, core + Android/web + design/QA leads. **Dependencies:** CORE-02, GRP-03, COM-02, FEAT-01/02, UI-01.

**Artifacts:** conversation/About/member-list/appearance/media/selection components in both clients; encrypted preference and local navigation adapters; `tests/scenarios/chat-refinements/`.

- [ ] Deliver safe rich descriptions, private per-chat theme/wallpaper preview/reset, account-level member search/admin filters and local authorized Groups in common.
- [ ] Deliver album grids/viewers, stable first-unread/latest/return-position navigation, bounded batch-selection feedback and accessible Android/web fast actions from specs §30.8.
- [ ] Test forbidden/private/stale membership discovery, hostile descriptions/images, contrast, interrupted album state, expired navigation anchors, new arrivals while reading history, mixed-author selections and role changes.
- [ ] Complete keyboard/TalkBack/screen-reader/IME/text-selection/gesture tests; preferences stay E2EE own-device state and no directory/social-graph or third-party wallpaper endpoint is introduced.

**Done when:** all ten selected-idea contracts in specs §30.8 pass on Android/web, including mentions/snooze integration from FEAT-02. No content/role/expiry bypass or iOS prerequisite exists.

### CALL-01 — Android/web direct audio and video

**Priority/owner:** P0, media + Android/web leads. **Dependencies:** FND-02 media proof, ID-02, MSG-02, CORE-02, UI-01.

**Artifacts:** encrypted call state/signaling, TURN issuer/config, Android Telecom adapter, browser WebRTC integration, call scenario suite.

- [ ] Implement authenticated offer/answer/ICE generations, 60 s TTL, first-answer arbitration, ended-call dedupe, explicit permissions, and relay policy.
- [ ] Implement native audio routes/focus/locked-screen behavior and browser active-session incoming UI; handle glare without auto-answer.
- [ ] Test network handover/ICE restart, blocked UDP/TURN TLS, delayed/cancelled offers, duplicate wakes, denied permissions, and no plaintext signaling fallback.

**Done when:** Android↔web calls work in certified networks, late offers never ring, camera/microphone activate only on explicit permitted actions, and revoked identities cannot start new calls.

### AND-02 / WEB-02 — Complete platform integration and parity

**Priority/owner:** P0, respective client leads. **Dependencies:** AND-01/WEB-01, GRP-03, COM-02, FEAT-01/02/03, CALL-01, UI-01.

**Artifacts:** complete Android/web flows, platform-specific diagnostics, `tests/scenarios/parity/`.

- [ ] Complete storage/preferences/devices/verification/search/call UI, rich descriptions/themes/member discovery, albums, mention/snooze modes, unread navigation and multi-select/fast actions, errors, policy-managed controls, and local-data clearing.
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

**Priority/owner:** P0, platform lead. **Dependencies:** FND-03, MSG-02, CALL-01/02, GRP-02/03, COM-02.

**Artifacts:** `deploy/charts/enclave/`, `deploy/airgap/`, network/port matrix, `docs/runbooks/install.md`.

- [ ] Package small/medium and connected/restricted overlays; configure primary/replica poolers, sync quorum, default-deny traffic, separate DB roles, object endpoints, private DNS/NTP/CA, and TURN ports.
- [ ] Use supported CNI/host firewall controls for media; test client access to presigned URLs and all discovery endpoints.
- [ ] Build signed fully offline bundles/assets/dependencies and prove no public fonts/CDN/STUN/license/update requests at runtime.

**Done when:** a clean customer-like restricted network installs the signed runtime/infrastructure, proves bootstrap/direct/group walking-slice exchange and TURN/SFU/push connectivity, and rejects prohibited egress. This closes deployment foundations only; full feature/profile qualification is mandatory at REL-01 after dependent feature workstreams finish.

### OPS-02 — Capacity, observability, and failure recovery

**Priority/owner:** P0, platform + QA leads. **Dependencies:** MSG-02, GRP-03, CALL-01, OPS-01.

**Artifacts:** dashboards/alerts, `tests/load/`, sanitized load/chaos evidence.

- [ ] Measure the 20k-socket medium baseline with documented direct/group/community/attachment mix; separate 10M-envelope/day stress tests from normal sizing.
- [ ] Instrument API/drain/ack, oldest outbox intent, leases/retries, replica lag, queue bytes, key health, revoke latency, and provider/device outcomes without payloads or stable personal identifiers.
- [ ] Fail gateway, worker, Valkey, and PostgreSQL primary; demonstrate HA durability, bounded overload, reconnect recovery, and independent worker polling.

**Done when:** medium-profile delivery/failure and observability foundations have workload-specific results, with dashboards/runbooks explaining recovery boundaries. This does not close large-announcement/large-deployment/100-video certification; SCALE-01 and REL-01 must complete those AC-OPS-02 assertions after these foundations.

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

### REL-01 — Complete Android/web launch readiness

**Priority/owner:** P0, product + QA + operations + security. **Dependencies:** every other P0 task in §2–5, all Launch rows in §6, and SEC-01/02; client-platform follow-on rows are excluded.

**Artifacts:** `docs/evidence/ga-readiness.md`, `docs/evidence/feature-acceptance.csv`, signed Android/web/backend release, release notes, support/runbook links.

- [ ] Assemble requirement coverage, device/browser/profile matrix, accessibility/usability evidence, load/chaos/restore results, audit remediation, license/support findings, and rollback instructions.
- [ ] Run clean-install → Android registration → web link (also browser-primary → Android link) → offline direct/group/community exchange → add/remove/promote/demote/join approval → community removal recovery → album/file/voice → member/common-group search → catch-up/selection → mentions-only/snooze recovery → identity change → revoke → direct call → signed upgrade acceptance.
- [ ] Execute every AC scenario in specs §31, with both enabled and disabled policy paths for opt-in features, and retain linked results for every supported Android/browser/profile combination. Publish exact supported versions, capacity and metadata/notification limits; no advertised Android/web feature may be listed as deferred.
- [ ] Include group calls/screen share/call links, polls/events/topics, scheduling/view-once, transfer/backup recovery, sealed sender, witnessed transparency, reviewed PQ MLS, opt-in archive/bot/local assistance and federated cross-deployment lifecycle in the final acceptance run.

**Done when:** named release owners approve documented evidence and there are no open P0 tasks or undisclosed critical/high defects. iOS/native desktop are separate client certification work; group media and all extension features are required for Android/web launch.

## 6. Additional launch workstreams and separate client targets

Every **Launch** row is P0 and feeds REL-01. Dependencies reference implementation foundations, never REL-01; final independent review runs over all completed launch modules. Early security consultation is part of each workstream rather than a cycle back from final SEC-02. Specs §31 contains the normative scenarios and pass/fail criteria for these tasks.

| ID | Gate | Deliverable / planned artifacts | Depends on | Acceptance / evidence |
|---|---|---|---|---|
| CALL-02 | Launch | Self-hosted LiveKit group media, screen sharing, raise hand, authenticated links, escalation, AV1 where certified | CALL-01, GRP-02, MSG-02 | AC-CALL-04–08; 50/100-participant profiles, removal/key-slot/rejoin, SFU ciphertext captures and real Android/web screen sharing. |
| EXT-01 | Launch | Polls/quizzes, events/RSVP, stickers/GIFs, on-device transcription, guests and abuse evidence | FEAT-02, COM-02, ID-02 | AC-COL-01/02/06, AC-MED-04/06, AC-ID-07, AC-SEC-09; mutation, permission, expiry and offline cases. |
| EXT-03 | Launch | Topics/threads, folders/filters, quiet/scheduled sends/reminders, view-once, custom grants/restrictions/slow mode | FEAT-02/03, COM-02 | AC-MSG-11, AC-ORG-02/03, AC-COL-03/04/05, AC-GRP-05, AC-MED-05; no audience/notification/retention bypass. |
| EXT-02 | Launch | Explicit bounded E2EE history transfer and resumable multipart attachments | FEAT-01/02, ID-02 | AC-SYNC-02, AC-MED-07; historical-only import, tamper/cancel/expiry, safe byte-for-byte upload resumption. |
| PRIV-01 | Launch | Separate sealed-sender transport, certificates, UAK access, unlinkable dedupe and abuse controls | ID-01, MSG-01, FND-02 | AC-SEC-06; recipient-side ≤60 s authenticated sender-status freshness and offline quarantine, explicit anonymous admission residual, no ambient device auth on sealed route, replay/rate-limit/metadata review. |
| PRIV-02 | Launch | Versioned device proof-of-possession with native/browser binding and rollover | ID-01, CORE-02, FND-02 | AC-ID-06; method/path/body/nonce binding, replay/cross-device/stolen-secret rejection. |
| WEB-03 | Launch | Safari certification and connected-profile opt-in browser Web Push | WEB-02, MSG-02, CALL-02 | AC-NOT-04 and AC-PLAT-01; browser crypto/storage/media/worker evidence, egress/consent and closed-browser limits. |
| TRUST-01 | Launch | Independently witnessed key transparency, customer-operated auditor/witness | ID-02, FND-02, OPS-01 | AC-SEC-07; inclusion/consistency/split-view/rotation, witness outage and signed checkpoint recovery. |
| BACKUP-01 | Launch | Recovery-key encrypted content backup, safe new-device import | CORE-01, FEAT-02, ID-02 | AC-SYNC-03; reviewed E2EE deletion journal/current independent checkpoint, no server-held recovery key or live-state rollback, wrong/lost key and expiry-aware restore. |
| ARCHIVE-01 | Launch | Visible policy-approved archive/bot participants and scoped integrations | GRP-02, ADM-01, FEAT-02 | AC-INT-01/02; disclosed full-group MLS reader versus separately encrypted addressed-only bot, audience/consent banner, ordinary key lifecycle, no silent direct-chat interception. |
| FED-01 | Launch | Opt-in mutually trusted on-prem federation, identity namespaces and routing | FND-01/02, ID-02, GRP-02, MSG-01 | AC-INT-03/04; two deployments, identity/PKI/revocation, offline dedupe, authorization, no plaintext relay. |
| PQ-01 | Launch | Reviewed supported PQ MLS profile and explicit negotiation | GRP-01/02, FND-02 | AC-SEC-08; pinned suite/implementation, independent review/vectors, interop and downgrade rejection; absence blocks GA. |
| ASSIST-01 | Launch | Optional local-only assistance/transcription models and offline signed model delivery | FEAT-02, CORE-01, OPS-01 | AC-INT-05 and AC-MED-06; summary/draft/translation of explicit local selections, no network inference or automatic sending. |
| SCALE-01 | Launch | Large-announcement, large deployment and media certification | GRP-03, COM-02, CALL-02, OPS-02 | AC-OPS-02/03; 5,000-account announcements, 100-video calls and named large deployment workload/limits measured. |
| BUILD-01 | Launch | Reproducible Android/web/backend artifacts and signed customer verification recipe | FND-03, OPS-03 | AC-OPS-06; isolated rebuild of unsigned payloads, explained signing differences, tampered artifact rejection. |
| IOS-01 | Client follow-on | Entitlement/distribution and Swift/Rust extension prototype | CORE-02, ID-02 | AC-PLAT-03 and mobile §10; signed physical-device APNs/NSE/PushKit/CallKit/local-push proof. |
| IOS-02 | Client follow-on | iOS app, native storage/lifecycle, accessibility, ReplayKit screen share | IOS-01, CALL-02, FEAT-03 | Complete §31 feature catalogue on iOS when that client ships; no reduced feature interpretation. |
| DESK-01 | Client follow-on | Signed native desktop packaging, native keystore/update/trust model | CORE-02, WEB-03, BUILD-01 | AC-PLAT-04; certify packaging separately from browser mode and repeat applicable feature catalogue. |

## 7. Definition of done and scope discipline

A completed implementation issue includes its exact changed paths, contract/schema change, relevant behavioral/failure evidence, privacy implications, and docs/diagram updates. Tests must demonstrate meaningful protocol/user invariants; avoid snapshotting implementation details or re-running unrelated suites without a reason. A passing happy-path demo does not close a security/reliability task.

Keep prerequisites acyclic. Update the requirement-to-task map when scope changes. Commit coherent reviewed slices and push checkpoints to the configured GitHub repository; never include private keys, tokens, payload-bearing traces, generated local databases, or production configuration in commits. Do not mark a milestone complete because only its documentation exists.
