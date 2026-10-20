# `identity.internal.provisioning`

Device-linking sessions (specs §4.4, §27.1; task ID-02). The server is a relay: it never sees the
account identity key, only an AES-GCM ciphertext encrypted between the two devices' X25519
ephemeral keys, and the SHA-256 of a single-use provisioning code.

| Step | Endpoint | Auth | Service method |
|---|---|---|---|
| New device opens session (reserves link address) | `POST /v1/provisioning/sessions` | Keycloak | `open` |
| New device polls / cancels | `GET`/`DELETE /v1/provisioning/sessions/{id}` | Keycloak | `get`, `cancel` |
| Existing device lists requests | `GET /v1/provisioning/sessions` | device | `openSessions` |
| Existing device approves: code | `POST /v1/devices/provisioning-code` | device | `issueCode` |
| Existing device delivers ciphertext | `POST /v1/provisioning/sessions/{id}/message` | device | `deliver` |
| Existing device declines | `DELETE /v1/provisioning/sessions/{id}/approval` | device | `cancel` |
| New device registers | `POST /v1/devices/link` | Keycloak | `authorizeLink` + `EnrollmentService.registerLinked` |

Security properties:

* Linking requires **both** a Keycloak token of the account **and** a code that only an
  authenticated existing device of the same account could obtain (specs §4.4).
* The user compares a code derived from the canonical `ENCLAVE-PROVISION-V1` transcript (deployment,
  account, session, reserved address, new device's ephemeral key, challenge) on both screens
  before approving, so a swapped session or key is visible.
* Codes are single-use (session `completed`), sessions expire with their reservation (10 min), and
  the relayed ciphertext is deleted on completion or cancellation.
* Labels are sanitized (no control/format characters, ≤ 64 chars).
