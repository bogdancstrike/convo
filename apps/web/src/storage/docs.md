# `src/storage` — encrypted local persistence

`EncryptedStore` is the browser storage adapter of specs §8 / task CORE-01.

| Object store | Contents | Visible metadata |
|---|---|---|
| `meta` | AES-GCM seal key, inner HMAC naming key, optional outer HMAC key (`CryptoKey`) — or, with a passphrase, the `lock` record (Argon2id parameters + wrapped seal/outer keys) instead of the usable seal/outer keys | key names, KDF parameters, auto-lock minutes |
| `records` | Namespaced JSON records (protocol state, identity, settings, conversations, outbox) | namespace, HMAC key |
| `messages` | Chat messages | HMAC conversation pseudonym + sort timestamp |
| `processed` | Processed envelope GUIDs (30-day dedupe window) | server GUID, time |

* Values are AES-256-GCM sealed JSON with a fresh 96-bit IV per write.
* `commit(ops)` encrypts first, then writes in a single IndexedDB transaction — the primitive the
  core uses for "decrypt → persist plaintext + ratchet state + processed marker → ack".
* `destroy()` deletes the database (sign-out, revocation wipe).

Limits: protects data at rest from casual copying, not from hostile code running in the same
origin (browser trust tier, UI.md §8). WebAuthn-PRF unlock is an optional follow-up.

## Passphrase lock (WEB-01, specs §28)

* `enablePassphrase(p, idleMinutes)` — the first time, the original seal key is non-extractable,
  so every record and message is re-sealed under a new key and every pseudonym gets an outer
  layer `HMAC(outer, inner pseudonym)` (computable from stored keys; the inner naming key stays
  on disk but cannot link IDs alone). All rows are read and prepared first, then replaced in one
  transaction (IndexedDB transactions cannot span WebCrypto awaits). Writes are serialized with
  this migration; the leader lock keeps other tabs from writing.
* The 64-byte key material is AES-GCM-wrapped with a KEK from **Argon2id** (`hash-wasm`, m = 64
  MiB, t = 3, p = 1, 16-byte salt; specs §21.3). In memory the keys are non-extractable.
* `open(name, passphrase)` throws `StoreLockedError` without it and `WrongPassphraseError` on a
  bad one; `isLocked(name)` answers without keys. `changePassphrase` re-wraps; `disablePassphrase`
  stores the (extractable) keys again so re-enabling needs no migration; `setIdleMinutes`.
* The device request-signing key is a non-extractable WebCrypto key and is not wrapped: it
  authenticates this device (revocable) but decrypts nothing.
* The app locks by reloading (drops all keys/plaintext in memory) on "Lock now" and after the
  configured inactivity (default 5 min); a forgotten passphrase means setting the browser up again.

Tests: `encryptedStore.test.ts`, `passphraseLock.test.ts` (on `fake-indexeddb`, cheap KDF);
E2E `tests/e2e/tests/storage-lock.spec.ts`.

`EncryptedStore.setJournal` lets account-history ciphertext work be committed atomically with local content changes; archive imports explicitly bypass journaling to avoid replication loops.
