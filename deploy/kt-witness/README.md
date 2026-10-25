# Key-transparency witness

A witness keeps the Convo server honest about its key log (SECURITY.md §7.5). It co-signs a tree
head only after checking:

1. the head is signed by the log key it pinned on first use (and for the same deployment);
2. the log only grew since the last head it signed (RFC 9162 consistency proof);
3. with the verifiable map: every leaf it downloads (request signed with its key) hashes into the
   signed log root, and the map of each account's newest leaf has the signed map root. It then
   co-signs version 2. Its state file keeps the leaf hashes and map (about 100 bytes per account).

A rollback, fork or changed log key is **never** signed: the witness logs `ALERT, not signing` and
exits with status 3. It re-signs the newest head every hour (`KT_RESIGN_SECONDS`) with its own time,
so clients can tell the witness is alive even when no device changed.

Run it **on another machine, under another operator** than the Convo server — otherwise it adds
little. In this deployment, the calls VPS is a natural place (it already runs independently of the
homelab).

## Set up

```sh
node witness.mjs --new-key        # prints KT_WITNESS_KEY=... and the server line
```

* Witness side (secret): `KT_WITNESS_KEY`, plus `KT_LOG_URL=https://convo.example.org`,
  `KT_WITNESS_ID=<name>`, a persistent `/data` volume (pinned log key and last signed head).
* Server side (public): `ENCLAVE_KT_WITNESSES=<name>:<public key>` (comma-separated for several).

```sh
docker run -d --name convo-kt-witness --restart unless-stopped \
  -e KT_LOG_URL=https://convo.example.org -e KT_WITNESS_ID=vps-witness -e KT_WITNESS_KEY=... \
  -v convo-kt-witness:/data -v "$PWD/witness.mjs:/app/witness.mjs:ro" node:22-alpine node /app/witness.mjs
```

Clients pin the witness keys they first see. Adding a witness later is fine for new devices; to
rotate a witness key for existing devices, announce it and treat it like a log-key change.

## If it alerts

Do not delete its state to "fix" it. Keep the log output and the state file: they are the evidence
that the server showed a history inconsistent with what it showed before.

Development: `docker compose up kt-witness` runs one against the local stack with a fixed,
public development key.
