# ADR-0004: durable encrypted account history and recovery

Status: Implementation in progress; independent cryptographic/security review remains a launch gate.

The user expects account data to follow login across devices, including when the original browser is offline. Future-only linking and ephemeral Keycloak development storage fail that expectation.

Use a durable, account-scoped ciphertext archive in PostgreSQL. Devices journal message and conversation changes atomically with their local commits, retry idempotent archive writes, and restore after trusted enrollment. Server-side account sequence allocation is serialized; devices persist the import cursor atomically with imported messages. Plaintext, attachment keys and contact identities inside the archive stay encrypted. Do not copy Signal ratchets or live MLS leaf state between devices.

Use standard Web Crypto HKDF-SHA256 and AES-256-GCM with random 96-bit nonces and explicit version/deployment/account binding. The archive key is domain-separated from the shared account identity secret. A generated 256-bit recovery code derives distinct wrapping and authorization keys. The server stores a wrapped account identity and SHA-256 of the authorization key. Keycloak login and proof of the recovery authorization key are both required to register a replacement device; lost device credentials are revoked. Keycloak never receives the recovery code or the archive decryption key.

History only exists after a device has uploaded it; show pending/offline/failure status instead of claiming backup completion. A recovery code must be saved before all trusted devices are lost. Administrators cannot recover E2EE keys from a password reset alone. Persist Keycloak and PostgreSQL data across Compose rebuilds. Backups and disaster recovery of the deployment remain operational requirements.

Fresh devices need a valid MLS join before sending/receiving new group traffic; restored history alone is not an MLS state transfer. The UI must expose that state where relevant.

References: [Web Cryptography API](https://www.w3.org/TR/webcrypto/), [Keycloak hostname configuration](https://www.keycloak.org/server/hostname).

### Last-device logout safeguard

Logging out must finish archive synchronization. If it would remove the last trusted device,
a configured recovery code is required before unregistering or destroying local keys. Without
another trusted device or a recovery code, uploaded ciphertext alone cannot restore the account
identity. A failed safeguard leaves this browser enrolled and its data intact.

### Local deletion and delayed archive updates

Local deletion records an encrypted suppression marker per known message identity, atomically
with removing its visible record. Replaying a delayed archive edit/star/receipt cannot recreate
that message. Clearing or deleting a chat marks only the known message IDs, so genuinely new
incoming messages remain deliverable. The local conversation hide marker prevents a delayed
conversation archive entry from reopening a deleted chat. A new unseen message or explicit
chat opening can reveal the conversation again. These markers remain local: this is not secure
erasure of the append-only account archive or deletion of another participant's copy.
