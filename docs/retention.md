# Data retention belongs to external operations

Convo does not run age-based data deletion. An operator-owned job decides when to archive or
remove persistent application data. This policy supersedes older module documentation that
referred to scheduled retention purges and fixed retention periods.

Application scheduling no longer removes activity, throughput, call history, attachment objects
or registry rows, abandoned multipart uploads, queued mailboxes, submission/idempotency records,
enrollment reservations, provisioning sessions, expired request IDs/nonces or WebSocket tickets.
The push dispatcher no longer schedules dead-letter deletion. Identity audit imports retain their
deduplication records. Issuing a nonce no longer prunes stored nonces to a per-device storage cap.
Keycloak realm event expiration is set to zero (no automatic event expiration), including during
idempotent setup of existing development realms.

Retained mailbox content and completed attachments remain readable after their legacy expiry
metadata passes. Existing expiry columns and legacy retention configuration can be used by an
external maintenance policy, but the application does not automatically apply them to deletion
or hide retained content because of age. The activity API does not advertise a 90-day retention
limit. Throughput counters are no longer automatically removed after two days.

Explicit user/admin actions still operate normally: revocation, role/membership changes,
recovery-kit removal, and acknowledged delivery operations perform their requested state changes.
Authentication credentials remain time-bound and single-use where applicable; retaining an
expired nonce or ticket does not make it valid again. Presence/cache TTLs represent transient
runtime state, not retention of persistent application records. User-selected disappearing
messages remain a user-requested action.

The remaining recurring application work is operational: identity audit synchronization, audit
name projection backfill, audit checkpoints, idle-socket management, and push delivery/retries.
A regression test restricts the set of annotation-based schedules so retention jobs cannot be
silently reintroduced. Maintenance helper methods have no scheduled or HTTP entry point.

External jobs should use an explicit policy, bounded batches and normal database/object-store
credentials. Archive signed audit history with its chain/checkpoint material before any operator
chooses to remove it. This change supplies no default deletion job or automatic cleanup policy.

## Reporting ranges

Retention is independent of reporting windows. The overview supports 1d, 7d, 30d and inclusive
custom UTC start/end dates; older retained data remains queryable. A single chart request can
cover up to 3,660 days, and may refer to dates arbitrarily far in the past. This is a query-size
bound, not an age limit on data.

Activity series, account statistics, levels and rankings apply both date bounds. Directory
snapshots (current account/device counts and last device activity) remain explicitly labelled as
current state. Longer throughput queries aggregate into at most 1,440 buckets, displaying
per-minute averages rather than relabelling bucket totals as per-minute traffic. Missing
observations remain absent and do not become fabricated history.
