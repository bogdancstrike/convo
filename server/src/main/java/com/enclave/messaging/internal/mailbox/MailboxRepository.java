package com.enclave.messaging.internal.mailbox;

import com.enclave.contracts.DeviceAddress;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for the {@code envelopes} mailbox table. */
@Repository
public class MailboxRepository {

    private final JdbcClient jdbc;

    MailboxRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Inserts an envelope; {@code serverTimestamp} is assigned by the database clock.
     */
    public void insert(Envelope e) {
        jdbc.sql("""
                INSERT INTO envelopes (account_id, device_id, guid, type, source_account, source_device,
                                       urgent, expires_at, content, group_id, epoch, group_seq)
                VALUES (:a, :d, :g, :t, :sa, :sd, :u, :e, :c, :gid, :ep, :gs)""")
                .param("a", e.recipient().accountId()).param("d", e.recipient().deviceId())
                .param("g", e.guid()).param("t", e.type().code())
                .param("sa", e.source() == null ? null : e.source().accountId())
                .param("sd", e.source() == null ? null : e.source().deviceId())
                .param("u", e.urgent()).param("e", Timestamp.from(e.expiresAt())).param("c", e.content())
                .param("gid", e.groupId()).param("ep", e.epoch()).param("gs", e.groupSeq())
                .update();
    }

    /** @return oldest-first page of unexpired envelopes (specs §24.5) */
    public List<Envelope> page(DeviceAddress device, int limit) {
        return jdbc.sql("""
                SELECT account_id, device_id, guid, type, source_account, source_device, server_ts, expires_at, urgent, content,
                       group_id, epoch, group_seq
                  FROM envelopes
                 WHERE account_id = :a AND device_id = :d AND expires_at > now()
                 ORDER BY server_ts, guid
                 LIMIT :l""")
                .param("a", device.accountId()).param("d", device.deviceId()).param("l", limit)
                .query(MailboxRepository::map).list();
    }

    /** @return whether at least one unexpired envelope is pending */
    public boolean hasPending(DeviceAddress device) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM envelopes WHERE account_id = :a AND device_id = :d AND expires_at > now())")
                .param("a", device.accountId()).param("d", device.deviceId()).query(Boolean.class).single();
    }

    /** @return total queued ciphertext bytes for quota admission */
    public long queuedBytes(DeviceAddress device) {
        return jdbc.sql("SELECT coalesce(sum(octet_length(content)), 0) FROM envelopes WHERE account_id = :a AND device_id = :d")
                .param("a", device.accountId()).param("d", device.deviceId()).query(Long.class).single();
    }

    /**
     * Deletes acknowledged envelopes. Scoped to the acknowledging device so one device can never
     * delete another device's copy.
     *
     * @return number of deleted rows
     */
    public int delete(DeviceAddress device, Collection<UUID> guids) {
        if (guids.isEmpty()) {
            return 0;
        }
        return jdbc.sql("DELETE FROM envelopes WHERE account_id = :a AND device_id = :d AND guid IN (:g)")
                .param("a", device.accountId()).param("d", device.deviceId()).param("g", guids)
                .update();
    }

    /** Deletes the entire mailbox of a device (revocation). */
    public int purge(DeviceAddress device) {
        return jdbc.sql("DELETE FROM envelopes WHERE account_id = :a AND device_id = :d")
                .param("a", device.accountId()).param("d", device.deviceId()).update();
    }

    /** Deletes expired envelopes in bounded batches. */
    public int purgeExpired(int batch) {
        return jdbc.sql("""
                DELETE FROM envelopes WHERE (account_id, device_id, guid) IN (
                    SELECT account_id, device_id, guid FROM envelopes WHERE expires_at < now() LIMIT :b)""")
                .param("b", batch).update();
    }

    private static Envelope map(ResultSet rs, int row) throws SQLException {
        UUID sourceAccount = rs.getObject("source_account", UUID.class);
        return new Envelope(
                new DeviceAddress(rs.getObject("account_id", UUID.class), rs.getInt("device_id")),
                rs.getObject("guid", UUID.class),
                EnvelopeType.fromCode(rs.getInt("type")),
                sourceAccount == null ? null : new DeviceAddress(sourceAccount, rs.getInt("source_device")),
                rs.getTimestamp("server_ts").toInstant(),
                rs.getTimestamp("expires_at").toInstant(),
                rs.getBoolean("urgent"),
                rs.getBytes("content"),
                rs.getBytes("group_id"),
                rs.getObject("epoch", Long.class),
                rs.getObject("group_seq", Long.class));
    }
}
