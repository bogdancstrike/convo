package com.enclave.admin.internal;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Hash-chained audit log. {@code hash = SHA-256(prev_hash || "seq\nat\nactor\naction\ntarget\nreason")};
 * appends are serialized with a table lock so the chain stays linear. {@link #verify()} recomputes
 * the chain; comparing its head with an independently stored copy detects a rewritten database.
 */
@Component
class AuditLog {
    record Entry(long seq, Instant at, String actor, String action, String target, String reason, String hash) {}
    record Verification(boolean valid, long entries, String head, Long firstBrokenSeq) {}
    /** Verification plus comparison with independent checkpoints ({@code checkpointMismatchSeq} = first disagreeing one). */
    record FullVerification(boolean valid, long entries, String head, Long firstBrokenSeq, int checkpointsChecked, Long checkpointMismatchSeq) {}

    /** Head hash after each entry (index = seq - 1), for checkpoint comparison. */
    @Transactional(readOnly = true)
    List<String> heads() {
        return jdbc.sql("SELECT hash FROM admin_audit ORDER BY seq").query((rs, i) -> HexFormat.of().formatHex(rs.getBytes(1))).list();
    }

    static final byte[] GENESIS = new byte[32];
    private final JdbcClient jdbc;
    private final Clock clock;

    AuditLog(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Transactional
    Entry append(String actor, String action, String target, String reason) {
        jdbc.sql("LOCK TABLE admin_audit IN EXCLUSIVE MODE").update();
        var last = jdbc.sql("SELECT seq, hash FROM admin_audit ORDER BY seq DESC LIMIT 1")
                .query((rs, i) -> new Object[] {rs.getLong(1), rs.getBytes(2)}).optional();
        long seq = last.map(r -> (long) r[0] + 1).orElse(1L);
        byte[] prev = last.map(r -> (byte[]) r[1]).orElse(GENESIS);
        Instant at = clock.instant().truncatedTo(ChronoUnit.MICROS); // PostgreSQL precision, so verify recomputes identically
        byte[] hash = hash(prev, seq, at, actor, action, target, reason);
        jdbc.sql("INSERT INTO admin_audit (seq, at, actor, action, target, reason, prev_hash, hash) VALUES (:seq, :at, :actor, :action, :target, :reason, :prev, :hash)")
                .param("seq", seq).param("at", OffsetDateTime.ofInstant(at, ZoneOffset.UTC)).param("actor", actor).param("action", action)
                .param("target", target).param("reason", reason).param("prev", prev).param("hash", hash).update();
        return new Entry(seq, at, actor, action, target, reason, HexFormat.of().formatHex(hash));
    }

    /** Whole chain in order (exports; bounded at 100k entries). */
    @Transactional(readOnly = true)
    List<Entry> all() {
        return jdbc.sql("SELECT seq, at, actor, action, target, reason, hash FROM admin_audit ORDER BY seq LIMIT 100000")
                .query((rs, i) -> new Entry(rs.getLong(1), rs.getObject(2, OffsetDateTime.class).toInstant(), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), HexFormat.of().formatHex(rs.getBytes(7)))).list();
    }

    @Transactional(readOnly = true)
    List<Entry> page(long before, int limit) {
        return jdbc.sql("SELECT seq, at, actor, action, target, reason, hash FROM admin_audit WHERE seq < :before ORDER BY seq DESC LIMIT :limit")
                .param("before", before).param("limit", Math.max(1, Math.min(limit, 500)))
                .query((rs, i) -> new Entry(rs.getLong(1), rs.getObject(2, OffsetDateTime.class).toInstant(), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), HexFormat.of().formatHex(rs.getBytes(7)))).list();
    }

    @Transactional(readOnly = true)
    Verification verify() {
        byte[] prev = GENESIS;
        long count = 0;
        var rows = jdbc.sql("SELECT seq, at, actor, action, target, reason, prev_hash, hash FROM admin_audit ORDER BY seq").query((rs, i) -> new Object[] {
                rs.getLong(1), rs.getObject(2, OffsetDateTime.class).toInstant(), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getBytes(7), rs.getBytes(8)}).list();
        for (Object[] r : rows) {
            long seq = (long) r[0];
            byte[] expected = hash(prev, seq, (Instant) r[1], (String) r[2], (String) r[3], (String) r[4], (String) r[5]);
            if (seq != count + 1 || !MessageDigest.isEqual(prev, (byte[]) r[6]) || !MessageDigest.isEqual(expected, (byte[]) r[7])) {
                return new Verification(false, count, HexFormat.of().formatHex(prev), seq);
            }
            prev = expected;
            count++;
        }
        return new Verification(true, count, HexFormat.of().formatHex(prev), null);
    }

    static byte[] hash(byte[] prev, long seq, Instant at, String actor, String action, String target, String reason) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(prev);
            digest.update(String.join("\n", Long.toString(seq), at.toString(), actor, action, target, reason).getBytes(StandardCharsets.UTF_8));
            return digest.digest();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
