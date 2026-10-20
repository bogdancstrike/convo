# `platform.web`

HTTP cross-cutting concerns:

* `ProblemWriter` — converts `EnclaveException` into RFC 9457 `application/problem+json` with a
  stable `code` member and `type = https://enclave.dev/errors/<code>` (specs §22). Also used by
  security filters that fail before MVC.
* `ApiExceptionHandler` — `@RestControllerAdvice` mapping domain, validation and framework
  exceptions; unexpected exceptions are logged and returned as an opaque `INTERNAL` problem.
* `DeploymentInfoController` — public `GET /v1/deployment-info` (deployment ID, display name,
  API versions, OIDC issuer/client ID) so the web build is deployment-independent.
