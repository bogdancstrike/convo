# `deploy/pgadmin` — database UI (development)

pgAdmin 4 runs at **http://localhost:5050** (bound to 127.0.0.1) in desktop mode, so there is no
pgAdmin login. `servers.json` pre-registers the compose PostgreSQL as "Enclave (dev)"; when you open
it, enter the database password (`enclave-dev-db` unless overridden by `ENCLAVE_DB_PASSWORD`) and
tick "Save password".

Everything you see there is ciphertext, public keys and routing metadata — message content is never
stored on the server. Do not run this service in production profiles.
