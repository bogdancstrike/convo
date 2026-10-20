# Backend tests

| Test | What it proves |
|---|---|
| `ModularityTests` | Spring Modulith boundaries (`ApplicationModules.verify()`), generated module docs |
| `DeviceAuthVectorsTest` | Shared Java/TypeScript signature + enrollment transcript vectors (`contracts/vectors`) |
| `UsernamePolicyTest`, `SubmissionDigestTest` | Handle derivation; order-independent, byte-sensitive idempotency digest |
| `*Test` in module packages | Unit tests of pure logic (signature canonicalization, digests, handle policy) |

Cross-component behaviour (real PostgreSQL, Valkey, Keycloak, browsers) is covered by the
Playwright suite in `tests/e2e`, run against the full `docker-compose.yaml` stack.
