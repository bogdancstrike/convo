package com.enclave.push.internal;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** SQL for durable wake intents ({@code push_intents}, {@code push_dead_letters}, V24). */
@Repository
class PushIntentStore {
    /** A claimed intent. */
    record Claimed(long id, UUID accountId, int deviceId, boolean urgent, int attempts, Instant expiresAt) {}
    /** The device's endpoint and when it was last woken (per kind). */
    record Target(String endpoint, Instant lastWake, Instant lastUrgent) {}

    private final JdbcClient jdbc;

    PushIntentStore(JdbcClient jdbc) { this.jdbc = jdbc; }

    /** Leases up to {@code n} due, unleased intents (calls first) and counts the attempt. */
    List<Claimed> claim(Instant now, Instant leaseUntil, int n) {
        return jdbc.sql("""
                UPDATE push_intents SET leased_until = :lease, attempts = attempts + 1
                WHERE id IN (SELECT id FROM push_intents WHERE due_at <= :now AND (leased_until IS NULL OR leased_until <= :now)
                             ORDER BY urgent DESC, due_at LIMIT :n FOR UPDATE SKIP LOCKED)
                RETURNING id, account_id, device_id, urgent, attempts, expires_at""")
                .param("lease", Timestamp.from(leaseUntil)).param("now", Timestamp.from(now)).param("n", n)
                .query((rs, i) -> new Claimed(rs.getLong("id"), rs.getObject("account_id", UUID.class), rs.getInt("device_id"),
                        rs.getBoolean("urgent"), rs.getInt("attempts"), rs.getTimestamp("expires_at").toInstant()))
                .list();
    }

    Optional<Target> target(Claimed c) {
        return jdbc.sql("SELECT endpoint, last_wake_at, last_urgent_at FROM push_endpoints WHERE account_id = :a AND device_id = :d")
                .param("a", c.accountId()).param("d", c.deviceId())
                .query((rs, i) -> new Target(rs.getString("endpoint"), instant(rs.getTimestamp("last_wake_at")), instant(rs.getTimestamp("last_urgent_at"))))
                .optional();
    }

    void remove(Claimed c) {
        jdbc.sql("DELETE FROM push_intents WHERE id = :id").param("id", c.id()).update();
    }

    /** Delivered: drop the intent and stamp the per-device rate limit for its kind. */
    void delivered(Claimed c, Instant now) {
        remove(c);
        jdbc.sql("UPDATE push_endpoints SET " + (c.urgent() ? "last_urgent_at" : "last_wake_at") + " = :now WHERE account_id = :a AND device_id = :d")
                .param("now", Timestamp.from(now)).param("a", c.accountId()).param("d", c.deviceId()).update();
    }

    /** The distributor dropped the topic: forget that endpoint (the app registers a new one). */
    void forgetEndpoint(Claimed c, String endpoint) {
        jdbc.sql("DELETE FROM push_endpoints WHERE account_id = :a AND device_id = :d AND endpoint = :e")
                .param("a", c.accountId()).param("d", c.deviceId()).param("e", endpoint).update();
        remove(c);
    }

    void retryAt(Claimed c, Instant due) {
        jdbc.sql("UPDATE push_intents SET due_at = :due, leased_until = NULL WHERE id = :id")
                .param("due", Timestamp.from(due)).param("id", c.id()).update();
    }

    /** Atomically moves the intent to the sanitized dead-letter table. */
    void dead(Claimed c, String reason, Instant now) {
        jdbc.sql("""
                WITH moved AS (DELETE FROM push_intents WHERE id = :id RETURNING account_id, device_id, urgent, attempts)
                INSERT INTO push_dead_letters (account_id, device_id, urgent, reason, attempts, failed_at)
                SELECT account_id, device_id, urgent, :reason, attempts, :now FROM moved""")
                .param("id", c.id()).param("reason", reason).param("now", Timestamp.from(now)).update();
    }

    int purge(Instant cutoff) {
        return jdbc.sql("DELETE FROM push_dead_letters WHERE failed_at < :cutoff").param("cutoff", Timestamp.from(cutoff)).update();
    }

    private static Instant instant(Timestamp t) { return t == null ? null : t.toInstant(); }
}
