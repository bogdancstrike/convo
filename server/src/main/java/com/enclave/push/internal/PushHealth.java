package com.enclave.push.internal;

import com.enclave.push.PushApi;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** {@link PushApi}: counts only, never identifiers. */
@Service
class PushHealth implements PushApi {
    private final JdbcClient jdbc;
    private final PushProperties properties;
    private final Clock clock;

    PushHealth(JdbcClient jdbc, PushProperties properties, Clock clock) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public Health health() {
        Instant now = clock.instant();
        record Pending(long count, Timestamp oldest) {}
        Pending pending = jdbc.sql("SELECT count(*) AS n, min(created_at) AS oldest FROM push_intents")
                .query((rs, i) -> new Pending(rs.getLong("n"), rs.getTimestamp("oldest"))).single();
        Map<String, Long> dead = new LinkedHashMap<>();
        jdbc.sql("""
                SELECT reason, urgent, count(*) AS n FROM push_dead_letters WHERE failed_at >= :since
                GROUP BY reason, urgent ORDER BY reason, urgent""")
                .param("since", Timestamp.from(now.minus(properties.deadLetterRetention())))
                .query(rs -> { dead.put(rs.getString("reason") + "/" + (rs.getBoolean("urgent") ? "call" : "message"), rs.getLong("n")); });
        Duration oldest = pending.oldest() == null ? Duration.ZERO : Duration.between(pending.oldest().toInstant(), now).abs();
        return new Health(pending.count(), oldest, dead);
    }

    @Override
    @Transactional
    public int redrive() {
        Instant now = clock.instant();
        int queued = jdbc.sql("""
                INSERT INTO push_intents (account_id, device_id, urgent, due_at, expires_at)
                SELECT DISTINCT d.account_id, d.device_id, false, CAST(:now AS timestamptz), CAST(:expires AS timestamptz)
                FROM push_dead_letters d JOIN push_endpoints e ON e.account_id = d.account_id AND e.device_id = d.device_id
                WHERE NOT d.urgent
                ON CONFLICT (account_id, device_id, urgent) DO NOTHING""")
                .param("now", Timestamp.from(now)).param("expires", Timestamp.from(now.plus(properties.intentTtl()))).update();
        jdbc.sql("DELETE FROM push_dead_letters WHERE NOT urgent").update();
        return queued;
    }
}
