# `platform` module

**Architecture position:** inbound HTTP plumbing shared by all feature modules. It depends on the
identity module's public `DeviceRequestAuthenticator`; no feature module depends on `platform`.

| Package | Responsibility |
|---|---|
| `config` | Infrastructure beans (`Clock`) |
| `security` | Two Spring Security chains (Keycloak bearer vs. device signature), CORS, body buffering |
| `web` | RFC 9457 problem rendering, `GET /v1/deployment-info` |

Configuration: `enclave.security.*` (`SecurityProperties`), `enclave.deployment.*`.
