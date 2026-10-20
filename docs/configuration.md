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
| `ENCLAVE_DISPLAY_NAME` | `Convo` | Organization name on sign-in screens |
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
| `display-name-claim` | `name` | OIDC claim with the organization display name (ADR-0002) |
| `phone-claim` | `phone_number` | OIDC claim with the organization phone (ADR-0002) |
| `min-phone-digits` | `4` | Minimum digits before a phone search runs |
| `directory-page-size` | `20` | |
| `key-packages.low-watermark` | `10` | `KEYPACKAGES_LOW` threshold |
| `key-packages.max-per-upload` / `max-stored` / `max-bytes` / `max-accounts-per-claim` | `100` / `200` / `8192` / `100` | MLS KeyPackage limits |
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
| `enclave.attachment-policy.max-file-megabytes` | `CONVO_ATTACHMENT_MAX_MB` in Compose | `100` | Plaintext MiB limit, advertised to both clients. Ciphertext overhead is calculated separately. |
| `upload-url-ttl` / `download-url-ttl` | | `15m` / `5m` | |
| `retention` | | `30d` | Object lifetime |
| `purge-interval` | | `PT1H` | |

## `enclave.groups.*` (`GroupsProperties`)

| Key | Default | Notes |
|---|---|---|
| `max-members` | `1000` | Member accounts per group |
| `max-devices` | `5000` | MLS leaves per group |
| `max-message-bytes` | `262144` | Application message size |
| `max-handshake-bytes` | `1048576` | Commit/Welcome size |
| `submission-retention` | `31d` | Idempotency records |
| `purge-interval` | `PT1H` | |

## Compose request origins

Compose enables `ENCLAVE_REQUEST_ORIGIN=true` (`enclave.deployment.request-origin`; default false
outside Compose). The trusted nginx request origin supplies public OIDC and S3 URLs. JWT keys always
come from the configured internal JWKS endpoint; the token issuer must match the current request's
realm URL before being mapped to the stable configured `OIDC_ISSUER` for account lookup. nginx
replaces incoming forwarding headers, and backend/Keycloak ports are not published.

`CONVO_HTTPS_PORT` defaults to 8443, the additional `CONVO_HTTPS_STANDARD_PORT` to 443, and
`ENCLAVE_HTTP_PORT` to 8088. Keep the two published HTTPS ports distinct.
`CONVO_HOSTNAME` defaults to
`convo.doncea.ro`, and `CONVO_SERVER_IP` to `192.168.1.144`. Configure matching hosts entries or
LAN DNS on client devices. The development certificate includes both hostname and IP; it is
created when missing and renewed if either SAN changes, preserving the existing private key.
Refresh the debug APK's exact certificate pin after regenerating the development certificate.
Keycloak's passwordless RP ID is `convo.doncea.ro`; changing the RP ID requires a deliberate
realm update and new passkey enrollment, because existing passkeys are bound to their RP ID.
The development Keycloak client allows only
its relative `/auth/convo/callback` route through a root URL resolved by Keycloak; no wildcard host
redirect is enabled.

## Account archive and recovery

Device-signed `/v1/history` PUT/GET routes store account-scoped encrypted entries independently of
mailbox retention. Entries are capped at 256 KiB; pages contain at most 100 entries. Recovery setup
uses device authentication; recovery download and new enrollment use account authentication plus
an independent recovery-code authorization verifier. Backup ciphertext is capped at 8 KiB. The
server never holds the recovery code or archive encryption key. See ADR-0004.
