# `contracts` — shared kernel

**Architecture position:** the only *shared* Spring Modulith module (declared in
`@Modulith(sharedModules = "contracts")`). Every module may depend on it; it depends on nothing.
Specs §1.2 prohibits a catch-all shared business module, so keep this package tiny.

| Type | Purpose |
|---|---|
| `ErrorCode` | Stable client-visible error codes from specs §22, with HTTP status mapping. |
| `EnclaveException` | Domain exception carrying an `ErrorCode` + structured problem properties. |
| `DeviceAddress` | `account_id.device_id`, the unit of delivery (specs §2). |
| `Base64Url` | Canonical unpadded base64url codec for all binary JSON fields. |
| `Uuids` | UUIDv7 generation for time-ordered envelope GUIDs. |
| `DeploymentProperties` | `enclave.deployment.*`: deployment ID bound into signed transcripts, display name, public URL. |
| `AttachmentPolicy` | `enclave.attachment-policy.*`: public plaintext attachment limit and derived ciphertext allowance. |
| `MessagePolicy` | `enclave.message-policy.*`: edit windows (15 min chats, 30 days channels) and delivery grace, enforced by receiving clients against server timestamps. |

Adding something here requires that at least two modules genuinely need it *and* that it carries
no module-specific behaviour. Error codes are a compatibility contract: never rename or reuse.
