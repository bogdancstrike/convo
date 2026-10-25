# ADR-0007: Key transparency as a witnessed verifiable log

**Status:** accepted (2026-10-25). **Context:** specs §19.4 (P0), TRUST-01, AC-SEC-07.

## Context

Safety numbers protect people who compare them; everyone else trusts the server to hand out the
right identity key and device list. Key transparency makes a substituted key or a hidden extra
device detectable without manual comparison.

## Decision

* An append-only **RFC 9162 Merkle log** of `account → (identity key, device-list version, device-list
  hash)`, one leaf per change, written in the same transaction as the device change, with a tree head
  signed (Ed25519) on every append. Encodings `CONVO-KT-*-V1` with shared vectors.
* **Clients** verify, for every account they encrypt to: the head signature (pinned log key), that the
  head extends the last head they accepted (rollback/fork detection), inclusion of the account's newest
  leaf, equality with the identity key and roster they use, and a fresh co-signature by a pinned
  witness on a head the current one extends. Results: verified / unwitnessed / stale / mismatch /
  log-error, shown in contact info on web and Android.
* **Witnesses** are separate processes with their own keys (`deploy/kt-witness`) that co-sign only
  consistent heads and re-sign hourly with their own timestamp (freshness).
* **Policy: warn.** Results are shown; sending is not blocked yet. Enforcement for mismatch/log-error
  under a hardened organization policy is the next step once the checks have run in production.

## Consequences and limits

* A verifiable log cannot prove that no newer entry exists for an account (it is not a prefix tree):
  a malicious server could serve an old entry. Owner monitoring (each device checks its own account when it syncs to its other
  devices; showing that result in Settings is still to do) and witnesses narrow this; an AKD/CONIKS-style verifiable map is the follow-up.
* Gossip of heads between clients over E2EE messages (split-view detection between people) is not
  implemented yet; each device detects forks against its own history and against witnessed heads.
* Log and witness keys are pinned on first use, not shipped with the app.
* The log grows by one 32-byte hash per device change; proofs are computed from cached leaf hashes.
