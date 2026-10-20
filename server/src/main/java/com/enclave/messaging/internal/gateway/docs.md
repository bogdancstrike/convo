# `messaging.internal.gateway`

The device WebSocket gateway (specs §9; tasks MSG-01, WEB-01).

## Connection lifecycle

1. Client calls `POST /v1/ws/tickets` (device-signed) → `WebSocketTicketService.issue` stores the
   SHA-256 of a random 32-byte ticket bound to the device and request `Origin` (TTL 30 s).
2. Client opens `wss://…/v1/ws` with subprotocols `["enclave.v1", "ticket.<ticket>"]`.
3. `TicketHandshakeInterceptor` enforces origin rules and atomically redeems the ticket
   (`DELETE … RETURNING`), checking the device is still active.
4. `GatewayWebSocketHandler` creates a `DeviceSession` (thread-safe decorator with send-buffer and
   time limits), registers it, refreshes `presence:*`, and drains the mailbox.

## Frames (`WireFormat`, JSON mirror of `enclave.ws.v1`)

| Client → server | Server → client |
|---|---|
| `{requestId, send: SendRequest}` | `{requestId, sendResult}` |
| `{ack: {guids}}` | `{envelope}` (server-initiated) |
| `{requestId, ping: {}}` | `{requestId, pong}`, `{queueEmpty}`, `{directive: {type}}`, `{error}` |

## Delivery and hints

* `DeviceSession` keeps at most one page in flight; acks trigger the next page; `queueEmpty` marks
  a drained queue.
* `HintBus` publishes `mail:{addr}` / `ctl:{addr}` on Valkey and also delivers locally; failures
  are swallowed because every `ping` re-checks the mailbox.
* `GatewayEventListener` — after-commit mail signals; persistent Modulith listeners for
  `DeviceRevoked` (purge mailbox, close with **4401**, notify own devices), `DeviceRegistered`
  (`DEVICE_LIST_CHANGED`) and `PrekeysLow` (`KEYS_LOW`). Shutdown closes with **4100 RECONNECT**.
* `DeviceSessionRegistry` closes sessions idle longer than `enclave.messaging.websocket.idle-timeout`.
