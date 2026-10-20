# `src/core` — browser protocol client

The web implementation of the client core facade (tasks CORE-01/02, MSG-01, WEB-01). The UI only
calls `EnclaveClient` methods and listens to its events; it never touches protocol state.

| File | Responsibility |
|---|---|
| `bootstrap.ts` | Wires encrypted store, repositories, Signal store and API; creates the client when enrolled |
| `enrollment.ts` | Shared enrollment: install-key generation, transcript proof, atomic persistence; first-device enrollment with pending-enrollment retry; prekey replenishment |
| `attachments.ts` | File preparation (canvas re-encode strips EXIF/location), encrypted upload via presigned URL, verified download, safe content types |
| `groups.ts` | `GroupManager`: MLS signer/KeyPackage stock, create/add/remove/own-device sync commits (local state advances only after DS acceptance), Welcome/commit/application processing with sender-vs-source check |
| `linking.ts` | Device linking: `LinkRequest` (new device: session, comparison code, polling, registration) and approving-side helpers |
| `sessions.ts` | Multi-device Signal fan-out (claims, session rebuild on registration change) and decryption; verified-identity enforcement |
| `outbox.ts` | Durable outbox: `queued → ready → accepted`, same-ciphertext retries, DEVICE_MISMATCH/STALE rebuilds, blocked/failed states |
| `client.ts` | `EnclaveClient`: socket lifecycle, envelope processing, content application (messages, reactions, edits, deletes, receipts, own-device sync, typing), conversation state, directives (KEYS_LOW, DEVICE_LIST_CHANGED, REVOKED) |
| `repositories.ts` | Typed record namespaces returning `StoreOp`s for atomic commits |
| `model.ts` | UI-facing domain model (`Conversation`, `ChatMessage`, `Settings`, `DeviceState`) |
| `leader.ts` | Web Locks leader election: only one tab runs the protocol client |

Invariants:

* **Decrypt → commit → ack.** Ratchet state, plaintext, conversation updates and the processed
  marker are committed in one IndexedDB transaction before the envelope is acknowledged.
* **Same ciphertext on retry.** An uncertain send outcome retries the stored submission ID.
* **Author rules.** Edits/deletes apply only when the mutation's author authored the target;
  only own devices may send `sync` content.
* **Privacy defaults.** Read receipts and typing indicators are off; delivery receipts are on.

`editPolicy.ts` holds the deployment edit windows and the shared send/receive edit rules (ADR-0005). `search.ts` matches all locally stored message bodies/file names with Romanian folding. `history.ts` journals and restores the encrypted account archive. `recovery.ts` wraps/retrieves the account identity with a user-held recovery code. `profile.ts` validates/re-encodes encrypted profile photo/status data. ADR-0004 describes trust and recovery limits.
