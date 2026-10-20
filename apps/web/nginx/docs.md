# `apps/web/nginx` — web origin configuration

`default.conf` is copied into the web image. It serves the SPA and proxies `/v1/*` (REST),
`/v1/ws` (WebSocket upgrade), `/auth/*` (Keycloak) and `/enclave-attachments/*` (S3 presigned
URLs to SeaweedFS, Host preserved for SigV4, streamed bodies up to 110 MiB), making the browser see one origin.

Security headers (specs §28): strict CSP (`script-src 'self'`, `connect-src 'self'`,
`frame-ancestors 'none'`), `no-referrer`, `nosniff`, COOP, Permissions-Policy allowing camera/microphone
for this origin only (voice notes, photo capture; requested only on user action), `no-cache` for the shell and immutable caching for
fingerprinted assets. `/actuator/*` is not exposed publicly.

TLS terminates on 443 (Compose 8443); port 80 serves an HTTPS-required helper. `15-self-signed-tls.sh` generates a persistent certificate. The exact `/auth/convo/callback` route serves the SPA; remaining `/auth` routes proxy Keycloak. All forwarding headers are overwritten.
