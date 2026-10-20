# `deploy/keycloak` — development identity provider

`enclave-realm.json` is imported by the Keycloak container on first start (`--import-realm`).

* Realm `enclave`, public PKCE client `enclave-web` (S256, no implicit/direct grants) with redirect
  URIs for the compose stack (`http://localhost:8088`) and Vite dev server (`:5173`).
* TOTP policy per specs §4.1.1 (6 digits, 30 s, SHA-1 for authenticator compatibility, one step
  look-ahead, no code reuse); passwordless WebAuthn requires user verification.
* **Test-only users** `alice`, `bob`, `carol` with passwords `<name>-dev-password`. Never use this
  file outside local development; production realms come from the customer IdP configuration.

Keycloak runs behind nginx at `/auth` (`KC_HTTP_RELATIVE_PATH=/auth`) so the issuer is
`http://localhost:8088/auth/realms/enclave`, same-origin with the web app.
