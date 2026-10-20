# Convo network and chat implementation plan

**Goal:** Deliver message-text search, LAN HTTPS with address-aware identity and file URLs, chat-list actions, Convo branding, and a conversation media/link/document gallery.

**Architecture:** Keep plaintext search and galleries on the device, reading encrypted IndexedDB records. Share conversation actions between the header and list. nginx terminates TLS and overwrites forwarding headers; Keycloak and backend use the request origin in Compose, with fixed internal JWKS and a stable canonical account issuer.

**Tech stack:** React/TypeScript, Spring Boot, Keycloak, nginx/OpenSSL, Docker Compose, Playwright.

## Tasks and verification

- [ ] Add regression coverage for global text search (older messages, Romanian folding, edits/deletes), list menu actions, HTTPS-required screen, non-localhost enrollment and signed attachment exchange.
- [ ] Add `core/search.ts` and repository scanning of all messages; expose live search through the client/hooks and render message excerpts in `ChatListPanel.tsx`.
- [ ] Extract shared conversation menu items and render a sibling arrow button in each chat row; connect info/search/close navigation in `MainLayout.tsx`.
- [ ] Update visible EN/RO strings, HTML title, SVG labels/wordmark and Keycloak labels to Convo while preserving protocol/database identifiers.
- [ ] Add persistent generated TLS certificates, nginx HTTP explanation page and HTTPS proxy, configurable HTTPS Compose port and clean forwarding headers.
- [ ] Enable dynamic Keycloak URLs and relative redirect validation. Update the existing dev realm without deleting users. Validate request-specific JWT issuer against fixed JWKS and canonicalize only after validation; sign S3 URLs for the request address.
- [ ] Add gallery routes/tabs in `navigation.ts`, entry in `InfoDrawer.tsx`, local month-grouped media/doc/link browsing with explicit file downloads and safe external links.
- [ ] Run web unit/type checks, backend tests/module boundaries, rebuild Docker Compose and run Chromium + Firefox end-to-end journeys at localhost and the LAN address.
- [ ] Update configuration/development/package docs and `tasks.md` with actual evidence and remaining backlog.

## Commands

`cd apps/web && npm test && npm run typecheck`

`cd server && ./gradlew test`

`docker compose up -d --build`

`docker compose --profile e2e run --build --rm e2e`

LAN-specific E2E base URL uses the host interface address with the HTTPS port. Keep all current database and object-store volumes. After this batch, continue the next pending web task with its own implementation and E2E evidence.

## Additional requested batches

- [ ] Channels: persist an admin-only posting mode in the groups ACL, expose creation/list routes and channel rail icon, hide member composer, reject member submissions on the backend, verify both roles E2E.
- [ ] Calls rail icon with an explicit localized “To be implemented” page.
- [ ] Settings: use the main pane, editable encrypted profile photo/text status, selective photo action menu, and four offline wallpaper previews.
- [ ] Position message menus beside their anchor and clamp to the viewport; verify placement near the bottom of a conversation.
- [ ] Add bogdan/bogdan and maria/maria to the seed and running realm. Persist Keycloak development data across container replacement.
- [ ] Commit and push each verified batch as authorized by the user.

## Priority: account history and recovery

- [ ] Durable append-only encrypted account archive, scoped by authenticated account and idempotent upload ID. Serialize per-account sequence allocation so pagination never skips a later-committing entry.
- [ ] Journal message/conversation/profile writes in the same local IndexedDB transaction, then upload/retry independently of message delivery. Import existing local history once; restore on every enrolled device and reconcile edits/tombstones without duplicating messages.
- [ ] Derive an AES-GCM archive key using HKDF-SHA256 with explicit account/deployment/domain binding from the shared account identity secret. Never archive Signal ratchets or copy live MLS leaf state across devices.
- [ ] Recovery code: random 256-bit secret, separately derived encryption and server authorization keys. Store only an encrypted account-identity backup and a hash of the authorization key on the backend.
- [ ] Recover after fresh Keycloak login plus recovery authorization, preserve account identity, revoke lost devices, register a fresh device, restore archive. Expose code creation/rotation and archive synchronization state in Settings.
- [ ] Test historical incoming/outgoing messages on a fresh linked browser, archive retry/offline recovery, wrong code, wrong account, successful all-devices-lost recovery, idempotent uploads, and ciphertext-only database contents.
