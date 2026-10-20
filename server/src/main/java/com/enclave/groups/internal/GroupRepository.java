package com.enclave.groups.internal;

import com.enclave.contracts.DeviceAddress;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for the groups module tables. All mutations run under the group row lock. */
@Repository
class GroupRepository {

    private final JdbcClient jdbc;

    GroupRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Group header. */
    record GroupRow(byte[] groupId, long epoch, long nextSeq, String status) {}

    /** Recorded commit. */
    record EventRow(long seq, long epoch, byte[] digest) {}

    boolean insertGroup(byte[] groupId, long epoch) {
        return jdbc.sql("INSERT INTO mls_groups (group_id, epoch) VALUES (:g, :e) ON CONFLICT DO NOTHING")
                .param("g", groupId).param("e", epoch).update() == 1;
    }

    /** Reads an active group without locking (read-only transactions cannot lock rows). */
    Optional<GroupRow> find(byte[] groupId) {
        return jdbc.sql("SELECT group_id, epoch, next_seq, status FROM mls_groups WHERE group_id = :g AND status = 'active'")
                .param("g", groupId)
                .query((rs, i) -> new GroupRow(rs.getBytes(1), rs.getLong(2), rs.getLong(3), rs.getString(4)))
                .optional();
    }

    /** Locks the group row; {@code shared} allows concurrent application messages but blocks commits. */
    Optional<GroupRow> lock(byte[] groupId, boolean shared) {
        return jdbc.sql("SELECT group_id, epoch, next_seq, status FROM mls_groups WHERE group_id = :g AND status = 'active' FOR "
                        + (shared ? "SHARE" : "UPDATE"))
                .param("g", groupId)
                .query((rs, i) -> new GroupRow(rs.getBytes(1), rs.getLong(2), rs.getLong(3), rs.getString(4)))
                .optional();
    }

    void advance(byte[] groupId, long epoch, long nextSeq) {
        jdbc.sql("UPDATE mls_groups SET epoch = :e, next_seq = :n WHERE group_id = :g")
                .param("e", epoch).param("n", nextSeq).param("g", groupId).update();
    }

    Map<UUID, Role> members(byte[] groupId) {
        Map<UUID, Role> members = new LinkedHashMap<>();
        jdbc.sql("SELECT account_id, role FROM mls_group_members WHERE group_id = :g ORDER BY joined_at, account_id")
                .param("g", groupId)
                .query(rs -> {
                    members.put(rs.getObject(1, UUID.class), Role.parse(rs.getString(2)));
                });
        return members;
    }

    List<DeviceAddress> devices(byte[] groupId) {
        return jdbc.sql("SELECT account_id, device_id FROM mls_group_devices WHERE group_id = :g ORDER BY account_id, device_id")
                .param("g", groupId)
                .query((rs, i) -> new DeviceAddress(rs.getObject(1, UUID.class), rs.getInt(2))).list();
    }

    boolean hasDevice(byte[] groupId, DeviceAddress device) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM mls_group_devices WHERE group_id = :g AND account_id = :a AND device_id = :d)")
                .param("g", groupId).param("a", device.accountId()).param("d", device.deviceId())
                .query(Boolean.class).single();
    }

    void upsertMember(byte[] groupId, UUID accountId, Role role) {
        jdbc.sql("""
                INSERT INTO mls_group_members (group_id, account_id, role) VALUES (:g, :a, :r)
                ON CONFLICT (group_id, account_id) DO UPDATE SET role = EXCLUDED.role""")
                .param("g", groupId).param("a", accountId).param("r", role.db()).update();
    }

    void deleteMember(byte[] groupId, UUID accountId) {
        jdbc.sql("DELETE FROM mls_group_members WHERE group_id = :g AND account_id = :a")
                .param("g", groupId).param("a", accountId).update();
    }

    void addDevice(byte[] groupId, DeviceAddress device) {
        jdbc.sql("INSERT INTO mls_group_devices (group_id, account_id, device_id) VALUES (:g, :a, :d) ON CONFLICT DO NOTHING")
                .param("g", groupId).param("a", device.accountId()).param("d", device.deviceId()).update();
    }

    void removeDevice(byte[] groupId, DeviceAddress device) {
        jdbc.sql("DELETE FROM mls_group_devices WHERE group_id = :g AND account_id = :a AND device_id = :d")
                .param("g", groupId).param("a", device.accountId()).param("d", device.deviceId()).update();
    }

    /** Drops a revoked device from every routing roster. */
    int removeDeviceEverywhere(DeviceAddress device) {
        return jdbc.sql("DELETE FROM mls_group_devices WHERE account_id = :a AND device_id = :d")
                .param("a", device.accountId()).param("d", device.deviceId()).update();
    }

    /** Groups of an account with the account's role and the current epoch. */
    List<Map<String, Object>> groupsOf(UUID accountId) {
        return jdbc.sql("""
                SELECT g.group_id, g.epoch, m.role,
                       (SELECT count(*) FROM mls_group_members x WHERE x.group_id = g.group_id) AS members
                  FROM mls_group_members m JOIN mls_groups g ON g.group_id = m.group_id
                 WHERE m.account_id = :a AND g.status = 'active'
                 ORDER BY g.created_at""")
                .param("a", accountId).query().listOfRows();
    }

    Optional<EventRow> eventBySubmission(byte[] groupId, byte[] submissionId) {
        return jdbc.sql("SELECT seq, epoch, digest FROM mls_group_events WHERE group_id = :g AND submission_id = :s")
                .param("g", groupId).param("s", submissionId)
                .query((rs, i) -> new EventRow(rs.getLong(1), rs.getLong(2), rs.getBytes(3))).optional();
    }

    void insertEvent(byte[] groupId, long seq, long epoch, byte[] submissionId, byte[] digest, byte[] payload) {
        jdbc.sql("""
                INSERT INTO mls_group_events (group_id, seq, epoch, submission_id, digest, payload)
                VALUES (:g, :s, :e, :sub, :d, :p)""")
                .param("g", groupId).param("s", seq).param("e", epoch).param("sub", submissionId)
                .param("d", digest).param("p", payload).update();
    }

    Optional<byte[]> submissionDigest(byte[] groupId, DeviceAddress origin, byte[] submissionId) {
        return jdbc.sql("""
                SELECT digest FROM mls_group_submissions
                 WHERE group_id = :g AND origin_account = :a AND origin_device = :d AND submission_id = :s""")
                .param("g", groupId).param("a", origin.accountId()).param("d", origin.deviceId()).param("s", submissionId)
                .query(byte[].class).optional();
    }

    void insertSubmission(byte[] groupId, DeviceAddress origin, byte[] submissionId, byte[] digest, Instant expiresAt) {
        jdbc.sql("""
                INSERT INTO mls_group_submissions (group_id, origin_account, origin_device, submission_id, digest, expires_at)
                VALUES (:g, :a, :d, :s, :dg, :e)""")
                .param("g", groupId).param("a", origin.accountId()).param("d", origin.deviceId()).param("s", submissionId)
                .param("dg", digest).param("e", Timestamp.from(expiresAt)).update();
    }

    int purgeSubmissions() {
        return jdbc.sql("DELETE FROM mls_group_submissions WHERE expires_at < now()").update();
    }
}
