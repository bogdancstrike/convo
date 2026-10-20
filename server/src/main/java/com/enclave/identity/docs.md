# `identity` module

**Architecture position:** Spring Modulith application module owning accounts, devices,
enrollment, Signal prekeys and device request authentication (specs §4, §12.1–12.2; tasks ID-01/02).
It never sees private keys or message content.

## Public API (this package)

| Type | Kind | Used by |
|---|---|---|
| `IdentityApi` | Query interface: active rosters, device liveness | messaging (fan-out validation, socket auth) |
| `DeviceRequestAuthenticator` | Verifies device proof-of-possession requests | platform security chain |
| `AuthenticatedDevice` | Request principal | all device-authenticated controllers |
| `SignedDeviceRequest` | Signature inputs incl. canonical string definition | platform security chain |
| `DeviceRoster` | Active devices + list version | messaging |
| `DeviceRegistered`, `DeviceRevoked`, `PrekeysLow`, `KeyPackagesLow` | Domain events | messaging gateway |

## Internals (`internal/`)

| Package | Responsibility |
|---|---|
| `account` | Account provisioning from OIDC identity, directory search |
| `device` | Device persistence, listing, revocation |
| `enrollment` | Reservations, first-device (primary) and linked-device registration |
| `provisioning` | Device-linking sessions: E2EE ProvisionMessage relay, single-use codes |
| `keys` | Signed/one-time prekeys and MLS KeyPackages: upload, status, atomic single-use claims |
| `auth` | ECDSA request-signature verification and replay protection |
| `web` | REST controllers and JSON DTOs |

Configuration: `enclave.identity.*` (`IdentityProperties`).
