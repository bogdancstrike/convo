package com.enclave.identity.internal.keys;

import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for {@code mls_key_packages}. */
@Repository
class KeyPackageRepository {

    private final JdbcClient jdbc;

    KeyPackageRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void insert(UUID accountId, int deviceId, byte[] ref, byte[] keyPackage) {
        jdbc.sql("""
                INSERT INTO mls_key_packages (account_id, device_id, kp_ref, key_package)
                VALUES (:a, :d, :r, :k) ON CONFLICT DO NOTHING""")
                .param("a", accountId).param("d", deviceId).param("r", ref).param("k", keyPackage)
                .update();
    }

    int count(UUID accountId, int deviceId) {
        return jdbc.sql("SELECT count(*) FROM mls_key_packages WHERE account_id = :a AND device_id = :d")
                .param("a", accountId).param("d", deviceId).query(Integer.class).single();
    }

    /** Atomically consumes the oldest KeyPackage of a device (never handed out twice). */
    Optional<byte[]> pop(UUID accountId, int deviceId) {
        return jdbc.sql("""
                DELETE FROM mls_key_packages
                 WHERE (account_id, device_id, kp_ref) = (
                       SELECT account_id, device_id, kp_ref FROM mls_key_packages
                        WHERE account_id = :a AND device_id = :d
                        ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
                RETURNING key_package""")
                .param("a", accountId).param("d", deviceId).query(byte[].class).optional();
    }

    void deleteAll(UUID accountId, int deviceId) {
        jdbc.sql("DELETE FROM mls_key_packages WHERE account_id = :a AND device_id = :d")
                .param("a", accountId).param("d", deviceId).update();
    }
}
