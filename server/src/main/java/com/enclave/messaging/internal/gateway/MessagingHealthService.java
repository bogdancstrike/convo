package com.enclave.messaging.internal.gateway;

import com.enclave.messaging.MessagingHealthApi;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** {@link MessagingHealthApi} over the mailbox table and this pod's session registry. */
@Service
class MessagingHealthService implements MessagingHealthApi {
    private final JdbcClient jdbc;
    private final DeviceSessionRegistry sessions;
    private final Clock clock;

    MessagingHealthService(JdbcClient jdbc, DeviceSessionRegistry sessions, Clock clock) {
        this.jdbc = jdbc; this.sessions = sessions; this.clock = clock;
    }

    @Override
    public Health health() {
        return jdbc.sql("""
                SELECT count(*) AS waiting, count(DISTINCT (account_id, device_id)) AS devices, min(server_ts) AS oldest
                  FROM envelopes WHERE expires_at > now()""")
                .query((rs, n) -> {
                    Timestamp oldest = rs.getTimestamp("oldest");
                    Duration age = oldest == null ? Duration.ZERO : Duration.between(oldest.toInstant(), clock.instant());
                    return new Health(rs.getLong("waiting"), rs.getLong("devices"), age.isNegative() ? Duration.ZERO : age, sessions.size());
                }).single();
    }
}
