# `apps/web/nginx` — web origin configuration

`default.conf` is copied into the web image. It serves the SPA and proxies `/v1/*` (REST),
`/v1/ws` (WebSocket upgrade), `/auth/*` (Keycloak) and `/enclave-attachments/*` (S3 presigned
URLs to SeaweedFS, Host preserved for SigV4, streamed bodies up to 110 MiB), making the browser see one origin.

Security headers (specs §28): strict CSP (`script-src 'self'`, `connect-src 'self'`,
`frame-ancestors 'none'`), `no-referrer`, `nosniff`, COOP, Permissions-Policy allowing camera/microphone
for this origin only (voice notes, photo capture; requested only on user action), `no-cache` for the shell and immutable caching for
fingerprinted assets. `/actuator/*` is not exposed publicly.

TLS terminates on 443 (Compose 8443); port 80 serves an HTTPS-required helper. `15-self-signed-tls.sh` generates a persistent certificate. The exact `/auth/convo/callback` route serves the SPA; remaining `/auth` routes proxy Keycloak. All forwarding headers are overwritten.

## Android App Links and stickers

`CONVO_ANDROID_CERT_SHA256` (comma-separated SHA-256 signing-certificate fingerprints) and
`CONVO_ANDROID_PACKAGE` (default `com.convo.android`) make the container serve
`/.well-known/assetlinks.json`, so `https://<host>/call/<token>` links open the Convo Android app
without a chooser (the APK's intent filter is `autoVerify` for `/call/`). Unset, no file is served
and links still open through the chooser. Compose defaults to the standard Android debug-keystore
certificate. `/stickers/` serves the bundled sticker packs with real 404s (no SPA fallback).
