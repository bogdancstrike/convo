# `src/auth` — organization sign-in

`OrganizationAuth` wraps `oidc-client-ts` for Keycloak Authorization Code + PKCE (specs §4.1).

* Passwords, passkeys and TOTP are handled entirely on Keycloak pages; this app never collects
  credentials (UI.md §4.0).
* Tokens are kept in `sessionStorage` and only used for `POST /v1/devices/reservations` and
  `POST /v1/devices/primary`. After enrollment every request is signed with the device key
  (`src/api/http.ts`), so an expired SSO session does not interrupt messaging.
* `signIn({ fresh: true })` sends `prompt=login` for step-up before enrollment.
