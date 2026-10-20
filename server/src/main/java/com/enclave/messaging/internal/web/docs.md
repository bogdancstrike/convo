# `messaging.internal.web`

REST adapters of the messaging module (all device-signature authenticated):

| Endpoint | Purpose |
|---|---|
| `PUT /v1/messages/{accountId}` | Direct submission (`SendRequest` JSON); same semantics as the WS `send` frame |
| `GET /v1/messages?limit=` | Bounded oldest-first drain, `Cache-Control: no-store` |
| `DELETE /v1/messages/{guid}` | Idempotent ack scoped to the calling device |
| `POST /v1/ws/tickets` | One-use, origin-bound WebSocket ticket (≤ 30 s) |

Wire records are shared with the gateway (`gateway.WireFormat`). Rejections surface as RFC 9457
problems (`DEVICE_MISMATCH` carries `missing`/`extra`, `STALE_DEVICES` carries `stale`).
