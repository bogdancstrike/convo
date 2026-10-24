package com.enclave.admin.internal;

import com.enclave.contracts.HandledOperation;
import com.enclave.messaging.SenderActivity;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** Minute buckets count accepted operations once, inside the publishing transaction. */
@Repository
class ThroughputStore {
    record Minute(Instant minute, long items, long calls, long uploads) {}
    private final JdbcClient jdbc;
    private final Clock clock;
    private final AdminProperties properties;
    ThroughputStore(JdbcClient jdbc, Clock clock, AdminProperties properties) { this.jdbc = jdbc; this.clock = clock; this.properties = properties; }
    @EventListener @Transactional void sent(SenderActivity ignored) { increment("items"); }
    @EventListener @Transactional void handled(HandledOperation event) { increment(event.kind() == HandledOperation.Kind.CALL_STARTED ? "calls" : "uploads"); }
    private void increment(String column) {
        if (!properties.activity().enabled()) return;
        // Column is selected exclusively from the constants above, never from input.
        jdbc.sql("INSERT INTO admin_throughput_minute(minute, " + column + ") VALUES (:minute, 1) ON CONFLICT (minute) DO UPDATE SET " + column + " = admin_throughput_minute." + column + " + 1")
                .param("minute", OffsetDateTime.ofInstant(clock.instant().truncatedTo(ChronoUnit.MINUTES), ZoneOffset.UTC)).update();
    }
    List<Minute> since(Instant from) {
        return jdbc.sql("SELECT minute, items, calls, uploads FROM admin_throughput_minute WHERE minute >= :from ORDER BY minute")
                .param("from", OffsetDateTime.ofInstant(from, ZoneOffset.UTC)).query((rs, i) -> new Minute(rs.getObject(1, OffsetDateTime.class).toInstant(), rs.getLong(2), rs.getLong(3), rs.getLong(4))).list();
    }
    List<Minute> between(Instant from, Instant to, int bucketMinutes) {
        return jdbc.sql("""
                SELECT date_bin(make_interval(mins => :bucket), minute, :origin) AS bucket,
                       sum(items) AS items, sum(calls) AS calls, sum(uploads) AS uploads
                FROM admin_throughput_minute WHERE minute >= :from AND minute < :to
                GROUP BY 1 ORDER BY 1""")
                .param("bucket", bucketMinutes).param("origin", OffsetDateTime.ofInstant(from, ZoneOffset.UTC))
                .param("from", OffsetDateTime.ofInstant(from, ZoneOffset.UTC)).param("to", OffsetDateTime.ofInstant(to, ZoneOffset.UTC))
                .query((rs, i) -> new Minute(rs.getObject(1, OffsetDateTime.class).toInstant(), rs.getLong(2), rs.getLong(3), rs.getLong(4))).list();
    }
    Instant startedAt() { return jdbc.sql("SELECT started_at FROM admin_throughput_start WHERE singleton").query(OffsetDateTime.class).single().toInstant(); }
    int purge() {
        return jdbc.sql("DELETE FROM admin_throughput_minute WHERE minute < :cutoff").param("cutoff", OffsetDateTime.ofInstant(clock.instant().minus(2, ChronoUnit.DAYS), ZoneOffset.UTC)).update();
    }
}
