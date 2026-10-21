package com.enclave.calls.internal;

import com.enclave.calls.CallsApi;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** {@link CallsApi} over the {@code calls} table (aggregates only). */
@Service
class CallsApiAdapter implements CallsApi {
    private final JdbcClient jdbc;

    CallsApiAdapter(JdbcClient jdbc) { this.jdbc = jdbc; }

    @Override
    public List<CallDay> callsPerDay(LocalDate from) {
        return jdbc.sql("""
                SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n, count(*) FILTER (WHERE video) AS v,
                       count(*) FILTER (WHERE group_id IS NOT NULL) AS g
                FROM calls WHERE created_at >= :from GROUP BY 1 ORDER BY 1""")
                .param("from", java.sql.Timestamp.from(from.atStartOfDay().toInstant(ZoneOffset.UTC)))
                .query((rs, i) -> new CallDay(rs.getObject("day", LocalDate.class), rs.getLong("n"), rs.getLong("v"), rs.getLong("g"))).list();
    }
}
