package com.enclave.identity.internal.keys;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for {@code signed_prekeys} and {@code one_time_prekeys}. */
@Repository
public class PrekeyRepository {

    private final JdbcClient jdbc;

    PrekeyRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Inserts or replaces the device's signed prekey. */
    public void upsertSigned(UUID accountId, int deviceId, SignedPreKey key) {
        jdbc.sql("""
                INSERT INTO signed_prekeys (account_id, device_id, key_id, public_key, signature)
                VALUES (:a, :d, :k, :p, :s)
                ON CONFLICT (account_id, device_id)
                DO UPDATE SET key_id = EXCLUDED.key_id, public_key = EXCLUDED.public_key, signature = EXCLUDED.signature""")
                .param("a", accountId).param("d", deviceId).param("k", key.keyId())
                .param("p", key.publicKey()).param("s", key.signature())
                .update();
    }

    /** Inserts one-time prekeys; an already-present key ID is left untouched (idempotent upload). */
    public void insertOneTime(UUID accountId, int deviceId, List<OneTimePreKey> keys) {
        for (OneTimePreKey key : keys) {
            jdbc.sql("""
                    INSERT INTO one_time_prekeys (account_id, device_id, key_id, public_key)
                    VALUES (:a, :d, :k, :p) ON CONFLICT DO NOTHING""")
                    .param("a", accountId).param("d", deviceId).param("k", key.keyId()).param("p", key.publicKey())
                    .update();
        }
    }

    /** @return remaining one-time prekeys */
    public int countOneTime(UUID accountId, int deviceId) {
        return jdbc.sql("SELECT count(*) FROM one_time_prekeys WHERE account_id = :a AND device_id = :d")
                .param("a", accountId).param("d", deviceId).query(Integer.class).single();
    }

    /** @return the device's signed prekey */
    public Optional<SignedPreKey> findSigned(UUID accountId, int deviceId) {
        return jdbc.sql("SELECT key_id, public_key, signature FROM signed_prekeys WHERE account_id = :a AND device_id = :d")
                .param("a", accountId).param("d", deviceId)
                .query((rs, i) -> new SignedPreKey(rs.getInt(1), rs.getBytes(2), rs.getBytes(3)))
                .optional();
    }

    /**
     * Atomically removes and returns one one-time prekey. {@code SKIP LOCKED} lets concurrent
     * claimers take different keys, so a key is never handed out twice.
     */
    public Optional<OneTimePreKey> popOneTime(UUID accountId, int deviceId) {
        return jdbc.sql("""
                DELETE FROM one_time_prekeys
                 WHERE (account_id, device_id, key_id) = (
                       SELECT account_id, device_id, key_id FROM one_time_prekeys
                        WHERE account_id = :a AND device_id = :d
                        ORDER BY key_id LIMIT 1 FOR UPDATE SKIP LOCKED)
                RETURNING key_id, public_key""")
                .param("a", accountId).param("d", deviceId)
                .query((rs, i) -> new OneTimePreKey(rs.getInt(1), rs.getBytes(2)))
                .optional();
    }
}
