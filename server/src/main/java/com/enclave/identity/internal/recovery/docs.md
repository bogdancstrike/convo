# Account recovery

`RecoveryService` stores encrypted account-identity backups and SHA-256 authorization verifiers.
Recovery requires a validated Keycloak login and a distinct code-derived authorization key.
`RecoveryController` serves backup/configuration/enrollment routes; `EnrollmentService` restores
the same identity, revokes lost device access and registers a fresh device atomically. No recovery
code or archive encryption key reaches the server. See ADR-0004.
