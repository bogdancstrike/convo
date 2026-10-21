# Push module (MSG-02)

Content-free wake-ups for devices without a live connection, through a self-hosted
[UnifiedPush](https://unifiedpush.org) distributor ([ntfy](https://ntfy.sh), Compose service `ntfy`).

## Flow

1. The Android app registers with the distributor app installed on the phone (e.g. ntfy pointed at
   the organization's ntfy server) and sends the resulting endpoint to `PUT /v1/push/endpoint`
   (device-authenticated; `DELETE` removes it).
2. When messaging stores envelopes for a device that has neither a local session nor a Valkey
   presence key, it publishes `MailWaiting` (no sender, conversation or content).
3. A durable intent is recorded with the envelopes; `PushDispatcher` POSTs `{"t":"wake"}` to the
   device's endpoint — at most once per `enclave.push.min-interval` per device, no redirects.
4. The app shows a generic "New message" notification (only if the user enabled notifications);
   opening it connects and decrypts the waiting mail.
5. Call rings are submitted with the `urgent` hint (direct and group `PUT .../messages`), so the
   wake is `{"t":"urgent"}` (own limit `enclave.push.urgent-min-interval`, default 3 s). Android
   shows a ringing, full-screen-capable "Incoming call" notification without the caller; opening
   it connects, decrypts the ring and shows the real call screen.

Delivery (durable intents, V24): `MailWaiting` is published just before the envelope transaction
commits, and `PushService` inserts a `push_intents` row in that same transaction (one pending
intent per device and kind; later mail coalesces into it). After commit it nudges
`PushDispatcher`, which also polls every `poll-interval` (default 1 s) as the safety net. Workers
claim due intents under a `lease` (`FOR UPDATE SKIP LOCKED`, so replicas never double-send and a
crashed worker's lease simply expires), then:

| Distributor answer | Result |
|---|---|
| 2xx | intent removed; `last_wake_at`/`last_urgent_at` stamped (durable rate limit) |
| 404/410 | the topic is gone: endpoint forgotten (the app re-registers on its next start) |
| transport error, 429, 5xx | retried after `retry-backoff` × 2^(attempt−1), up to `max-attempts` |
| other 4xx, too many attempts, past `intent-ttl` (1 h) / `urgent-ttl` (60 s) | moved to `push_dead_letters` (`rejected`, `gave_up`, `expired`) |

Dead letters hold only device, kind, reason and attempt count (no endpoint or content) and are
purged after `dead-letter-retention` (24 h). The admin console's **Health** tab shows aggregate
counts (`GET /v1/admin/health`, `HEALTH_READ`) and lets security operators re-queue failed message
wakes after an outage (`POST /v1/admin/push/redrive`, `PUSH_REDRIVE`, reason audited first).
Expired call rings are never re-sent. A server restart does not lose a pending wake.

Presence: closing a device's last socket on a replica deletes its Valkey presence key
(compare-and-delete), so a killed app counts as offline immediately rather than after the
90 s TTL.

## Safety

- Endpoints must be on an allow-listed origin (`enclave.push.allowed-origins`); no user-info, max
  512 chars. This prevents using the server to call arbitrary URLs (SSRF).
- The server reaches the distributor through `enclave.push.internal-origin` (same path/query).
- Endpoints are capability URLs: stored per device, deleted on device revocation, never logged.
- Wake payloads are constant; the distributor learns only that some device got mail, and whether
  the sender marked it urgent (which the server already knows).

| Class | Role |
|---|---|
| `PushProperties` | `enclave.push.*` |
| `PushService` | Registration, allow-list, transactional intent enqueue, one delivery attempt, revocation cleanup |
| `PushIntentStore` | SQL for intents, leases, retries and dead letters |
| `PushDispatcher` | Lease/poll loop, outcome handling, dead-letter purge |
| `PushHealth` | `PushApi`: aggregate counts and redrive |
| `PushController` | `/v1/push/endpoint` |
