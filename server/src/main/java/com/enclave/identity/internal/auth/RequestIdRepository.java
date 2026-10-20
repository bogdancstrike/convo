package com.enclave.identity.internal.auth;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Replay cache of consumed request IDs (table {@code device_request_ids}). */
@Repository
class RequestIdRepository {

    private final JdbcClient jdbc;

    RequestIdRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Records a request ID once.
     *
     * @return {@code true} if the ID was unused, {@code false} on replay
     */
    boolean consume(UUID accountId, int deviceId, String requestId, Instant expiresAt) {
        return jdbc.sql("""
                INSERT INTO device_request_ids (account_id, device_id, request_id, expires_at)
                VALUES (:a, :d, :r, :e) ON CONFLICT DO NOTHING""")
                .param("a", accountId).param("d", deviceId).param("r", requestId)
                .param("e", Timestamp.from(expiresAt))
                .update() == 1;
    }

    /** @return number of expired entries deleted */
    int purgeExpired() {
        return jdbc.sql("DELETE FROM device_request_ids WHERE expires_at < now()").update();
    }
}
