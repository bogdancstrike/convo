package com.enclave.identity.internal.device;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for the {@code devices} table. */
@Repository
public class DeviceRepository {

    private static final String COLUMNS = """
            account_id, device_id, registration_id, device_signing_key, device_key_profile, name_enc,
            platform, created_at, last_seen_day, revoked_at""";

    private final JdbcClient jdbc;

    DeviceRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Inserts a newly enrolled device. */
    public void insert(Device d) {
        jdbc.sql("""
                INSERT INTO devices (account_id, device_id, registration_id, device_signing_key,
                                     device_key_profile, name_enc, platform, last_seen_day)
                VALUES (:a, :d, :r, :k, :p, :n, :pl, current_date)""")
                .param("a", d.accountId()).param("d", d.deviceId()).param("r", d.registrationId())
                .param("k", d.signingKey()).param("p", d.keyProfile()).param("n", d.nameEnc())
                .param("pl", d.platform())
                .update();
    }

    /** @return the device including revoked ones */
    public Optional<Device> find(UUID accountId, int deviceId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM devices WHERE account_id = :a AND device_id = :d")
                .param("a", accountId).param("d", deviceId).query(DeviceRepository::map).optional();
    }

    /** @return active devices ordered by device ID */
    public List<Device> findActive(UUID accountId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM devices WHERE account_id = :a AND revoked_at IS NULL ORDER BY device_id")
                .param("a", accountId).query(DeviceRepository::map).list();
    }

    /** @return number of active devices */
    public int countActive(UUID accountId) {
        return jdbc.sql("SELECT count(*) FROM devices WHERE account_id = :a AND revoked_at IS NULL")
                .param("a", accountId).query(Integer.class).single();
    }

    /**
     * Marks a device revoked and deletes its prekeys in the same transaction.
     *
     * @return {@code true} if an active device was revoked by this call
     */
    public boolean revoke(UUID accountId, int deviceId) {
        int updated = jdbc.sql("""
                UPDATE devices SET revoked_at = now()
                 WHERE account_id = :a AND device_id = :d AND revoked_at IS NULL""")
                .param("a", accountId).param("d", deviceId).update();
        if (updated == 1) {
            jdbc.sql("DELETE FROM one_time_prekeys WHERE account_id = :a AND device_id = :d")
                    .param("a", accountId).param("d", deviceId).update();
            jdbc.sql("DELETE FROM signed_prekeys WHERE account_id = :a AND device_id = :d")
                    .param("a", accountId).param("d", deviceId).update();
        }
        return updated == 1;
    }

    /** Records day-granularity activity; no-op when already recorded today. */
    public void touch(UUID accountId, int deviceId) {
        jdbc.sql("""
                UPDATE devices SET last_seen_day = current_date
                 WHERE account_id = :a AND device_id = :d AND last_seen_day IS DISTINCT FROM current_date""")
                .param("a", accountId).param("d", deviceId).update();
    }

    private static Device map(ResultSet rs, int row) throws SQLException {
        Timestamp created = rs.getTimestamp("created_at");
        Timestamp revoked = rs.getTimestamp("revoked_at");
        Date seen = rs.getDate("last_seen_day");
        return new Device(rs.getObject("account_id", UUID.class), rs.getInt("device_id"),
                rs.getInt("registration_id"), rs.getBytes("device_signing_key"),
                rs.getString("device_key_profile"), rs.getBytes("name_enc"), rs.getString("platform"),
                created.toInstant(), seen == null ? null : seen.toLocalDate(),
                revoked == null ? null : revoked.toInstant());
    }
}
