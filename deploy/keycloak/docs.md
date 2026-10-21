# `deploy/keycloak` — development identity provider

`enclave-realm.json` is imported only on the first start of a new Keycloak volume
(`--import-realm`). Existing realms require explicit admin updates; never delete the volume
just to apply configuration, because changing user subjects breaks account identity continuity.

- Realm `enclave`, Convo branding, public S256 PKCE clients `enclave-web` and `convo-android`.
  Web redirects use only the relative `/auth/convo/callback` route; Android uses the registered
  `com.convo.android:/oauth2redirect` callback. Implicit and direct password grants are disabled.
- nginx exposes Keycloak on the app's HTTPS origin under `/auth`. Keycloak resolves the public
  host dynamically from nginx's overwritten forwarding headers; its internal port is not published.
  The historical canonical backend issuer stays unchanged for stable account lookup.
- Deployment hostname: `convo.doncik.ro` (`CONVO_HOSTNAME`). The setup job sets the realm's
  passwordless WebAuthn RP ID to it on every run; user verification and resident credentials are
  required, and passkeys are enabled. Local Compose: point the hostname at the Docker host in the
  hosts file or LAN DNS.
  IP-based ordinary sign-in remains available, but cannot use a domain-bound passkey.
- Optional `WebAuthn Register Passwordless` action is enabled, so users can enroll a passkey after
  their initial sign-in through Keycloak Account Console → Account security → Signing in.
- TOTP: six digits, 30 seconds, SHA-1 for authenticator compatibility, one-step look-ahead,
  and no code reuse. Fingerprints/device PINs are verified by the OS, never stored in Keycloak.
- Declarative profile requires an editable `phoneNumber` for users, including the first-login
  update-profile form. Its `html5-tel` annotation requests a telephone keyboard on phones.
  The `phone` scope maps it to `phone_number`; this claim does not prove phone ownership.
- `themes/convo/login` inherits stock `keycloak.v2` authentication forms. Its responsive styling
  uses Convo colors, logo, 48px controls, 16px text fields, light/dark and reduced-motion support.
- Development users: `alice`, `bob`, `carol` use `<name>-dev-password`; `bogdan`/`bogdan` and
  `maria`/`maria` are also included. These seeded credentials are for local development only.

The H2 development database persists in a Compose volume. Production uses a supported database,
customer-managed identities, trusted TLS certificates, and separately reviewed realm policies.
- Required actions: the realm JSON lists every action Convo relies on, and the setup script
  registers and enables any that are missing on an existing realm (`UPDATE_PROFILE`,
  `UPDATE_PASSWORD`, `CONFIGURE_TOTP`, `webauthn-register`, `webauthn-register-passwordless`,
  `delete_credential`, …). A realm import registers only the actions its JSON lists; without
  `webauthn-register-passwordless` Keycloak answers the Settings passkey action with
  `kc_action_status=error`.
- Passkeys are managed inside Convo Settings: the server lists the account's own passkeys (read-only
  service account) and the clients open Keycloak's `webauthn-register-passwordless` and
  `delete_credential:<id>` actions; `/auth/convo/passkey-done` shows the real outcome
  (`kc_action_status`). Production hides the account console (`CONVO_KEYCLOAK_ACCOUNT=off`).
