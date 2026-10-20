package com.enclave.messaging.internal.submission;

import com.enclave.contracts.DeviceAddress;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for {@code submissions} (idempotency records, specs §26.1). */
@Repository
class SubmissionRepository {

    private final JdbcClient jdbc;

    SubmissionRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Stored digest of a prior submission with the same ID, if any (locks the row). */
    Optional<byte[]> findDigest(DeviceAddress origin, byte[] submissionId) {
        return jdbc.sql("""
                SELECT digest FROM submissions
                 WHERE origin_account = :a AND origin_device = :d AND submission_id = :s FOR UPDATE""")
                .param("a", origin.accountId()).param("d", origin.deviceId()).param("s", submissionId)
                .query(byte[].class).optional();
    }

    /**
     * Records an accepted submission.
     *
     * @return {@code false} if a concurrent request recorded the same ID first
     */
    boolean insert(DeviceAddress origin, byte[] submissionId, byte[] digest, String resultJson, Instant expiresAt) {
        return jdbc.sql("""
                INSERT INTO submissions (origin_account, origin_device, submission_id, digest, result, expires_at)
                VALUES (:a, :d, :s, :g, CAST(:r AS jsonb), :e) ON CONFLICT DO NOTHING""")
                .param("a", origin.accountId()).param("d", origin.deviceId()).param("s", submissionId)
                .param("g", digest).param("r", resultJson).param("e", Timestamp.from(expiresAt))
                .update() == 1;
    }

    int purgeExpired() {
        return jdbc.sql("DELETE FROM submissions WHERE expires_at < now()").update();
    }
}
