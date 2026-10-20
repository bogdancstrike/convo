package com.enclave.calls.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Table {@code calls}: authorization metadata only. */
@Repository
class CallRepository {
    record CallRow(UUID callId, String room, UUID createdBy, UUID peer, byte[] groupId, boolean video, Instant createdAt, Instant endedAt) {}

    private final JdbcClient jdbc;
    CallRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    void insert(CallRow row) {
        jdbc.sql("""
                INSERT INTO calls (call_id, room, created_by, peer, group_id, video, created_at)
                VALUES (:id, :room, :by, :peer, :group, :video, :at)""")
                .param("id", row.callId()).param("room", row.room()).param("by", row.createdBy()).param("peer", row.peer())
                .param("group", row.groupId()).param("video", row.video()).param("at", OffsetDateTime.ofInstant(row.createdAt(), ZoneOffset.UTC))
                .update();
    }

    Optional<CallRow> find(UUID callId) {
        return jdbc.sql("SELECT * FROM calls WHERE call_id = :id").param("id", callId).query(CallRepository::map).optional();
    }

    void end(UUID callId, Instant at) {
        jdbc.sql("UPDATE calls SET ended_at = :at WHERE call_id = :id AND ended_at IS NULL")
                .param("id", callId).param("at", OffsetDateTime.ofInstant(at, ZoneOffset.UTC)).update();
    }

    /** Retention: authorization rows are not a call history; drop them after they can't be joined. */
    int purgeBefore(Instant cutoff) {
        return jdbc.sql("DELETE FROM calls WHERE created_at < :cutoff").param("cutoff", OffsetDateTime.ofInstant(cutoff, ZoneOffset.UTC)).update();
    }

    private static CallRow map(ResultSet rs, int row) throws SQLException {
        var ended = rs.getObject("ended_at", OffsetDateTime.class);
        return new CallRow(rs.getObject("call_id", UUID.class), rs.getString("room"), rs.getObject("created_by", UUID.class),
                rs.getObject("peer", UUID.class), rs.getBytes("group_id"), rs.getBoolean("video"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(), ended == null ? null : ended.toInstant());
    }
}
