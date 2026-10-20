# `apps/web/nginx` — web origin configuration

`default.conf` is copied into the web image. It serves the SPA and proxies `/v1/*` (REST),
`/v1/ws` (WebSocket upgrade), `/auth/*` (Keycloak) and `/enclave-attachments/*` (S3 presigned
URLs to SeaweedFS, Host preserved for SigV4, streamed bodies up to 110 MiB), making the browser see one origin.

Security headers (specs §28): strict CSP (`script-src 'self'`, `connect-src 'self'`,
`frame-ancestors 'none'`), `no-referrer`, `nosniff`, COOP, restrictive Permissions-Policy (camera
and microphone will be enabled with calls), `no-cache` for the shell and immutable caching for
fingerprinted assets. `/actuator/*` is not exposed publicly.
