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

## Safety

- Endpoints must be on an allow-listed origin (`enclave.push.allowed-origins`); no user-info, max
  512 chars. This prevents using the server to call arbitrary URLs (SSRF).
- The server reaches the distributor through `enclave.push.internal-origin` (same path/query).
- Endpoints are capability URLs: stored per device, deleted on device revocation, never logged.
- Wake payload is constant; the distributor learns only that "some device got mail".

| Class | Role |
|---|---|
| `PushProperties` | `enclave.push.*` |
| `PushService` | Registration, allow-list, rate-limited wake sending, revocation cleanup |
| `PushController` | `/v1/push/endpoint` |
