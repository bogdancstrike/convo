package com.enclave.identity.internal.auth;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Issued device-proof nonces (table {@code device_nonces}); stores hashes only. */
@Repository
class NonceRepository {
    private final JdbcClient jdbc;
    NonceRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    void store(UUID accountId, int deviceId, String nonce, Instant expiresAt, int maxOutstanding) {
        jdbc.sql("INSERT INTO device_nonces (account_id, device_id, nonce_hash, expires_at) VALUES (:a, :d, :h, :e) ON CONFLICT DO NOTHING")
                .param("a", accountId).param("d", deviceId).param("h", hash(nonce)).param("e", Timestamp.from(expiresAt)).update();

    }

    /** Consumes a live nonce exactly once (atomic delete). */
    boolean consume(UUID accountId, int deviceId, String nonce) {
        return jdbc.sql("DELETE FROM device_nonces WHERE account_id = :a AND device_id = :d AND nonce_hash = :h AND expires_at > now()")
                .param("a", accountId).param("d", deviceId).param("h", hash(nonce)).update() == 1;
    }

    int purgeExpired() {
        return jdbc.sql("DELETE FROM device_nonces WHERE expires_at < now()").update();
    }

    private static byte[] hash(String nonce) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(nonce.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
