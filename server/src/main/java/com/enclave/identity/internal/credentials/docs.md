# `identity.internal.credentials`

Read-only view of the sign-in credentials an account registered at Keycloak.

* `CredentialStatusProperties` — `enclave.identity.credential-status.*` (service-account client,
  admin URL, timeout, cache TTL). Disabled by default.
* `CredentialStatusService` — client-credentials token (cached until shortly before expiry), then
  `GET /admin/realms/{realm}/users/{sub}/credentials`. Reports `passkey` for
  `webauthn-passwordless` and `otp` for authenticator apps. Any failure → `unavailable`.

Exposed as `GET /v1/account/credentials` (device-authenticated, own account only, `no-store`).
Clients enable native app/chat locks only after `passkey: true`; an `unavailable` answer never
disables locks that are already on. Convo never stores passkeys, biometrics or device PINs.

The Keycloak client must have only `realm-management/view-users`; see
`deploy/keycloak/credential-status-client.sh`.
