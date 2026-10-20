# `src/storage` — encrypted local persistence

`EncryptedStore` is the browser storage adapter of specs §8 / task CORE-01.

| Object store | Contents | Visible metadata |
|---|---|---|
| `meta` | Non-extractable AES-GCM seal key and HMAC naming key (`CryptoKey`) | key names |
| `records` | Namespaced JSON records (protocol state, identity, settings, conversations, outbox) | namespace, HMAC key |
| `messages` | Chat messages | HMAC conversation pseudonym + sort timestamp |
| `processed` | Processed envelope GUIDs (30-day dedupe window) | server GUID, time |

* Values are AES-256-GCM sealed JSON with a fresh 96-bit IV per write.
* `commit(ops)` encrypts first, then writes in a single IndexedDB transaction — the primitive the
  core uses for "decrypt → persist plaintext + ratchet state + processed marker → ack".
* `destroy()` deletes the database (sign-out, revocation wipe).

Limits: protects data at rest from casual copying, not from hostile code running in the same
origin (browser trust tier, UI.md §8). Passphrase/WebAuthn-PRF key wrapping is a follow-up task.
Tests: `encryptedStore.test.ts` (runs on `fake-indexeddb`).

`EncryptedStore.setJournal` lets account-history ciphertext work be committed atomically with local content changes; archive imports explicitly bypass journaling to avoid replication loops.
