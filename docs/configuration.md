# Backend configuration reference

All settings can be provided in `application.yaml`, as JVM system properties, or as environment
variables (Spring relaxed binding: `enclave.messaging.envelope-ttl` → `ENCLAVE_MESSAGING_ENVELOPETTL`).
Values are validated at start-up; an invalid value prevents the server from starting.

## Infrastructure (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DB_URL`, `DB_USER`, `DB_PASSWORD`, `DB_POOL_SIZE` | `jdbc:postgresql://localhost:5432/enclave`, `enclave`, `enclave`, `20` | PostgreSQL (primary) |
| `VALKEY_HOST`, `VALKEY_PORT` | `localhost`, `6379` | Valkey hints/presence |
| `OIDC_ISSUER` | `http://localhost:8088/auth/realms/enclave` | Expected token issuer (public URL) |
| `OIDC_JWKS_URI` | `http://localhost:8180/.../certs` | JWKS endpoint reachable from the server |
| `OIDC_CLIENT_ID` | `enclave-web` | Public client ID published to the web app |
| `ENCLAVE_DEPLOYMENT_ID` | `enclave-dev` | Deployment ID bound into signed transcripts — never change after first enrollment |
| `ENCLAVE_DISPLAY_NAME` | `Enclave` | Organization name on sign-in screens |
| `ENCLAVE_PUBLIC_URL` | `http://localhost:8088` | Public base URL |
| `PORT` | `8080` | HTTP port |

## `enclave.deployment.*` (`DeploymentProperties`)

| Key | Default | Notes |
|---|---|---|
| `id` | `enclave-dev` | `[a-z0-9][a-z0-9.-]{1,62}` |
| `display-name` | `Enclave` | |
| `public-base-url` | `http://localhost:8088` | |

## `enclave.security.*` (`SecurityProperties`)

| Key | Default | Notes |
|---|---|---|
| `oidc.issuer` | — (required) | |
| `oidc.jwk-set-uri` | — (required) | |
| `oidc.audiences` | empty | Accepted `aud` values; empty disables the check |
| `oidc.public-client-id` | `enclave-web` | |
| `allowed-origins` | empty | CORS origins; empty = same-origin deployment |
| `max-body-bytes` | `1048576` | Max buffered body for signed requests |

## `enclave.identity.*` (`IdentityProperties`)

| Key | Default | Notes |
|---|---|---|
| `max-devices-per-account` | `5` | specs §26.3 |
| `reservation-ttl` | `10m` | Enrollment reservation lifetime |
| `prekey-low-watermark` | `20` | `KEYS_LOW` directive threshold |
| `max-prekeys-per-upload` | `200` | |
| `max-stored-prekeys` | `1000` | Per device |
| `username-claim` | `preferred_username` | OIDC claim used for handles |
| `directory-page-size` | `20` | |
| `device-auth.max-signature-lifetime` | `5m` | Max signed-request validity |
| `device-auth.clock-skew` | `30s` | |
| `device-auth.purge-interval` | `PT1H` | Replay-cache cleanup |
| `reservation-purge-interval` | `PT6H` | |

## `enclave.messaging.*` (`MessagingProperties`)

| Key | Default | Notes |
|---|---|---|
| `envelope-ttl` | `30d` | Undelivered envelope retention |
| `max-envelope-bytes` | `262144` | Per device ciphertext |
| `max-devices-per-send` | `64` | |
| `drain-page-size` | `100` | In-flight page per socket |
| `submission-retention` | `31d` | Idempotency records |
| `max-transient-ttl` | `30s` | Typing/ICE envelopes |
| `max-mailbox-bytes` | `104857600` | Per-device quota |
| `expiry-purge-interval` | `PT5M` | |
| `submission-purge-interval` | `PT1H` | |
| `websocket.ticket-ttl` | `30s` | One-use socket tickets |
| `websocket.idle-timeout` | `90s` | Close silent sockets |
| `websocket.max-frame-bytes` | `1048576` | |
| `websocket.send-buffer-bytes` | `4194304` | Slow-consumer bound |
| `websocket.send-time-limit` | `10s` | |
| `websocket.allowed-origins` | empty | Empty = must match request host |

## `enclave.attachments.*` (`AttachmentsProperties`)

| Key | Env | Default | Notes |
|---|---|---|---|
| `endpoint` | `ENCLAVE_ATTACHMENTS_ENDPOINT` | `http://localhost:8333` | S3 endpoint used by the server |
| `public-endpoint` | `ENCLAVE_ATTACHMENTS_PUBLIC_ENDPOINT` | `ENCLAVE_PUBLIC_URL` | Endpoint presigned URLs point to (must reach the store with the same Host) |
| `region` | | `us-east-1` | Signing region |
| `bucket` | `ENCLAVE_ATTACHMENTS_BUCKET` | `enclave-attachments` | |
| `access-key`, `secret-key` | `ENCLAVE_ATTACHMENTS_ACCESS_KEY`, `..._SECRET_KEY` | dev values | |
| `path-style` | | `true` | |
| `create-bucket` | | `true` | Create at start-up if missing |
| `max-bytes` | | `110100480` | Encrypted size limit (100 MiB + padding) |
| `upload-url-ttl` / `download-url-ttl` | | `15m` / `5m` | |
| `retention` | | `30d` | Object lifetime |
| `purge-interval` | | `PT1H` | |
