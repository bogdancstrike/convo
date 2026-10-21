# Convo security operations

How Convo's security features are configured in practice, what each one protects, and how they are
tested. Design-level guarantees and the threat model live in [arf.md §4](arf.md) and
[specs.md](specs.md); this document is the operator's and developer's view.

## 1. Sign-in and passwordless (passkeys)

### What a passkey is used for

| Use | What the passkey proves | What it does **not** do |
|---|---|---|
| Sign in to the organization (Keycloak) without a password | possession of the authenticator + user verification (fingerprint, face, screen lock) | it does not hold or unlock message keys |
| Gate for app lock and per-chat locks | the account has a confirmed passkey, so the user can re-verify on demand | it is not the encryption key of the local store |

A passkey is **not** a replacement for the recovery code. Messages and history are end-to-end
encrypted under keys that live on the user's devices; the history archive on the server is
encrypted under an account key that only the user's devices or the **recovery code** can unwrap.
A passkey proves *who you are* to the sign-in service; it gives no key material, so after losing every device a passkey gets you signed in, but only the
recovery code can decrypt the uploaded history. (A future option is WebAuthn PRF, which can derive
a secret from a passkey; it is listed as an open item, not implemented.)

### How it is configured

The Convo realm is `enclave`, served by Convo's **own** Keycloak on the app origin under `/auth`
(Compose: the `keycloak` service; Kubernetes: `app-charts/convo/keycloak`). Passkeys must be served
from the app's origin because WebAuthn binds them to an RP ID:

| Setting | Value | Where |
|---|---|---|
| Passwordless WebAuthn RP ID | the deployment hostname (`convo.doncik.ro`) | realm JSON; re-applied from `CONVO_HOSTNAME` by the setup job on every run |
| User verification | `required` | realm JSON |
| Resident key (discoverable credential) | `Yes` | realm JSON |
| Required actions | `webauthn-register-passwordless`, `delete_credential`, `UPDATE_PROFILE`, `UPDATE_PASSWORD`, `CONFIGURE_TOTP`, `webauthn-register`, `VERIFY_PROFILE`, … registered **and enabled** | realm JSON `requiredActions` + setup job |
| `enclave-web` redirect URIs | exactly `/convo/callback`, `/convo/passkey-done`, `/convo/admin` (no wildcards), PKCE S256 | realm JSON + setup job |
| Account console | hidden on the public origin (`CONVO_KEYCLOAK_ACCOUNT=off`) | web image / chart values |
| Admin console, master realm | hidden on the public origin (`CONVO_KEYCLOAK_ADMIN=off`) | web image / chart values |

The setup job (`deploy/keycloak/credential-status-client.sh`, Compose `keycloak-setup`,
Kubernetes post-sync Job) is idempotent. It keeps the RP ID equal to the hostname, registers any
missing required action, provisions the read-only `convo-credential-status` service account
(`realm-management/view-users` only) and the Convo admin roles.

> **Lesson learned (2026-10-21).** A realm *import* registers only the required actions its JSON
> lists. Production was imported from a JSON that listed only `VERIFY_PROFILE`, so Keycloak
> answered "Turn on passwordless sign-in" with `kc_action_status=error`, while the result page
> unconditionally said "Your passkey is ready". Both are fixed: the JSON lists the actions, the
> setup job registers missing ones on existing realms, and the result page shows Keycloak's real
> outcome. `identity-config.spec.ts` and the production smoke test now catch this class of error.

### The flows

All passkey changes happen in Keycloak (with Convo's sign-in theme); Convo never holds rights to
create or delete credentials.

1. **Turn on / add a passkey.** Settings → Privacy → Passkeys opens Keycloak's
   application-initiated action `kc_action=webauthn-register-passwordless` (web: new tab; Android:
   Custom Tab) for the `enclave-web` client with a throwaway PKCE challenge. The browser talks to the
   authenticator; Keycloak stores the public key. Keycloak redirects to `/auth/convo/passkey-done`
   with `kc_action_status=success|cancelled|error`; the page (`passkey-done.html` +
   `passkey-done.js`, CSP `script-src 'self'`) shows that outcome. `state` is prefixed `add.` or
   `remove.` so the page knows which action ran.
2. **List.** `GET /v1/account/credentials` (device-signed) returns the account's own passkeys —
   ID, name, date — read through the `convo-credential-status` service account. `?refresh=true`
   bypasses the short server cache; clients use it when Settings opens and when the user returns
   from the Keycloak tab.
3. **Remove.** Keycloak's `kc_action=delete_credential:<id>` with Keycloak's own confirmation page.
4. **Sign in with a passkey.** Keycloak's login page offers "Sign in with Passkey" (and conditional
   UI). The Android app and the web app use the normal OIDC code + PKCE flow; nothing changes in
   Convo.
5. **Locks.** App lock and per-chat locks can only be turned **on** after the IdP confirms a
   passkey. Web unlocks with WebAuthn user verification on the same RP ID; Android with
   BiometricPrompt (fingerprint, face or screen lock). A status outage never silently turns locks
   off, and removing the last passkey keeps existing locks on until the user turns them off.

Passkey names must be unique per account (Keycloak rejects duplicates with "Device already exists
with the same name"; nothing is changed).

### Tests

| Test | Where | Proves |
|---|---|---|
| `identity-config.spec.ts` | Compose e2e | required actions enabled, RP ID = hostname, UV required, redirect URIs exact, unauthenticated API calls refused |
| `chat-lock.spec.ts` | Compose e2e (hostname) | Settings → add passkey → list → chat lock / app lock with the passkey → remove via `delete_credential` |
| `passkey-edge-cases.spec.ts` | Compose e2e (hostname) | cancel → "Nothing was changed"; duplicate name refused; two passkeys listed |
| `passwordless.spec.ts` | Compose e2e | result page per status; real registration + passkey-only sign-in |
| `CredentialStatusServiceTest` | server unit | passkey list mapping, cache, outage = `unavailable` (never "no passkey") |
| `smoke/*.smoke.spec.ts` | **production**, after every deploy | origin/issuer, security headers, hidden consoles, 401s, real passkey registration and passkey-only sign-in on the live hostname |

Run the production smoke suite (dedicated smoke account; remove its passkeys first, the runner in
`deploy/k8s.md` does this):

```bash
BASE_URL=https://convo.doncik.ro SMOKE_USERNAME=… SMOKE_PASSWORD=… \
  npx playwright test -c smoke/playwright.smoke.config.ts      # from tests/e2e
```

## 2. Device authentication

Every API call after sign-in carries the organization token **and** an ECDSA P-256 signature by
the device key (profile `ENCLAVE-REQ-V2`: method, path, body digest, request ID and a single-use
server nonce). A stolen token alone cannot call the API. Shared Java/TypeScript vectors in
`contracts/vectors` keep both sides identical.

## 3. Administration

The admin console (`/admin`) signs in with Keycloak and requires an admin realm role; each endpoint
checks a scoped permission (`convo-admin`, `convo-helpdesk`, `convo-org-admin`, `convo-security`,
`convo-auditor`). Sensitive actions need a reason and a recent sign-in (step-up), and are written
to a hash-chained audit log with independent checkpoints; denied attempts are audited too. No
admin permission reads message content: no such API exists.

## 4. Public surface in production

| Path | Exposure |
|---|---|
| `/`, `/assets/*` | SPA with strict CSP (`default-src 'self'`, `frame-ancestors 'none'`, no `unsafe-eval`; `wasm-unsafe-eval` for WebAssembly crypto) |
| `/v1/*` | API: token + device signature (except public discovery such as `/v1/deployment-info`) |
| `/auth/realms/enclave/*` | Keycloak login, OIDC, required actions |
| `/auth/admin/`, `/auth/realms/master/`, `/auth/realms/*/account` | **404** on the public origin |
| `/actuator/*` | **404** |
| `/rtc` | LiveKit signalling (join tokens issued by the server per device) |
| `/enclave-attachments/*` | presigned S3 URLs for ciphertext objects |

Secrets (LiveKit, TURN, credential-status client, Keycloak admin, S3) exist only in the cluster
(`app-charts/convo/utils/create-secrets.sh`) or in the ignored `.env` for Compose.
