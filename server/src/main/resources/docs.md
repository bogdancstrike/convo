# Backend resources

* `application.yaml` — default configuration. All Enclave settings live under `enclave.*` and are
  bound to validated `@ConfigurationProperties` records owned by each module; infrastructure
  endpoints take environment variables (`DB_URL`, `VALKEY_HOST`, `OIDC_ISSUER`, …). See
  `docs/configuration.md` at the repository root.
* `db/migration/` — Flyway migrations, one prefix per owning module.
