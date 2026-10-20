# `src/lib` — framework-free utilities

Small, dependency-free helpers used across layers. Nothing here knows about Enclave protocols.

| File | Purpose |
|---|---|
| `bytes.ts` | base64url (wire format), UTF-8, random bytes, SHA-256, ArrayBuffer conversion |
| `emitter.ts` | Typed event emitter (core → UI notifications, socket events) |
| `mutex.ts` | Promise mutex that serializes protocol-state writers within a tab |
