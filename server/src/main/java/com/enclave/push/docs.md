# Push module (MSG-02)

Content-free wake-ups for devices without a live connection, through a self-hosted
[UnifiedPush](https://unifiedpush.org) distributor ([ntfy](https://ntfy.sh), Compose service `ntfy`).

## Flow

1. The Android app registers with the distributor app installed on the phone (e.g. ntfy pointed at
   the organization's ntfy server) and sends the resulting endpoint to `PUT /v1/push/endpoint`
   (device-authenticated; `DELETE` removes it).
2. When messaging stores envelopes for a device that has neither a local session nor a Valkey
   presence key, it publishes `MailWaiting` (no sender, conversation or content).
3. `PushService` POSTs `{"t":"wake"}` to the device's endpoint — at most once per
   `enclave.push.min-interval` per device, asynchronously, no redirects.
4. The app shows a generic "New message" notification (only if the user enabled notifications);
   opening it connects and decrypts the waiting mail.
5. Call rings are submitted with the `urgent` hint (direct and group `PUT .../messages`), so the
   wake is `{"t":"urgent"}` (own limit `enclave.push.urgent-min-interval`, default 3 s). Android
   shows a ringing, full-screen-capable "Incoming call" notification without the caller; opening
   it connects, decrypts the ring and shows the real call screen.

Delivery: transport errors, 429 and 5xx are retried with exponential backoff (`max-attempts`,
default 4; `retry-backoff`, default 2 s, doubling). 404/410 mean the distributor dropped the
topic: the endpoint is forgotten and the app re-registers it on its next start (it re-sends its
endpoint once per process). Other 4xx are not retried. Retries are in memory: a server restart
during the ~14 s retry window loses that wake (the message itself is safe in the mailbox).

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
| `PushService` | Registration, allow-list, rate-limited wake sending, revocation cleanup |
| `PushController` | `/v1/push/endpoint` |
