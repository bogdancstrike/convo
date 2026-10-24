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
    private final AuditNames names;

    AuditLog(JdbcClient jdbc, Clock clock, AuditNames names) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.names = names;
    }

    @Transactional
    Entry append(String actor, String action, String target, String reason) {
        return appendAt(clock.instant(), actor, action, target, reason);
    }

    @Transactional
    Entry appendAt(Instant sourceTime, String actor, String action, String target, String reason) {
        var display = names.resolve(List.of(new Entry(0, sourceTime, actor, action, target, reason, ""))).getFirst();
        jdbc.sql("LOCK TABLE admin_audit IN EXCLUSIVE MODE").update();
        var last = jdbc.sql("SELECT seq, hash FROM admin_audit ORDER BY seq DESC LIMIT 1")
                .query((rs, i) -> new Object[] {rs.getLong(1), rs.getBytes(2)}).optional();
        long seq = last.map(r -> (long) r[0] + 1).orElse(1L);
        byte[] prev = last.map(r -> (byte[]) r[1]).orElse(GENESIS);
        Instant at = sourceTime.truncatedTo(ChronoUnit.MICROS); // PostgreSQL precision, so verify recomputes identically
        byte[] hash = hash(prev, seq, at, actor, action, target, reason);
        jdbc.sql("INSERT INTO admin_audit (seq, at, actor, action, target, reason, prev_hash, hash, actor_name, target_name) VALUES (:seq, :at, :actor, :action, :target, :reason, :prev, :hash, :actorName, :targetName)")
                .param("seq", seq).param("at", OffsetDateTime.ofInstant(at, ZoneOffset.UTC)).param("actor", actor).param("action", action)
                .param("target", target).param("reason", reason).param("prev", prev).param("hash", hash).param("actorName", display.actorName()).param("targetName", display.targetName()).update();
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

    /** Filters run before pagination so older matches are not hidden by recent traffic. */
    @Transactional(readOnly = true)
    List<Entry> search(long before, int limit, String query, String action, String user, Instant from, Instant to, List<String> matchingIds) {
        return jdbc.sql("""
                SELECT seq, at, actor, action, target, reason, hash FROM admin_audit
                WHERE seq < :before
                  AND (:query = '' OR position(lower(:query) in lower(actor || ' ' || action || ' ' || target || ' ' || reason)) > 0 OR EXISTS (SELECT 1 FROM unnest(string_to_array(:matchingIds, ',')) AS m WHERE m <> '' AND (position(m in actor) > 0 OR position(m in target) > 0)))
                  AND (:action = '' OR action = :action OR starts_with(action, :action || '.') OR (:action = 'denied' AND starts_with(action, 'denied:')))
                  AND (:user = '' OR EXISTS (SELECT 1 FROM unnest(string_to_array(:user, ',')) AS u WHERE position(u in actor) > 0 OR position(u in target) > 0))
                  AND at >= :from AND at <= :to
                ORDER BY seq DESC LIMIT :limit
                """)
                .param("before", before).param("limit", Math.max(1, Math.min(limit, 500)))
                .param("query", query).param("action", action).param("user", user).param("matchingIds", String.join(",", matchingIds))
                .param("from", OffsetDateTime.ofInstant(from == null ? Instant.parse("1970-01-01T00:00:00Z") : from, ZoneOffset.UTC))
                .param("to", OffsetDateTime.ofInstant(to == null ? Instant.parse("9999-12-31T23:59:59Z") : to, ZoneOffset.UTC))
                .query((rs, i) -> new Entry(rs.getLong(1), rs.getObject(2, OffsetDateTime.class).toInstant(), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), HexFormat.of().formatHex(rs.getBytes(7)))).list();
    }

    @Transactional(readOnly = true)
    AdminTableQuery.Page<AuditNames.View> table(AdminTableQuery query, java.util.Map<String, String> scope) {
        var fields = java.util.Map.of("seq", "seq", "at", "at", "actor", "coalesce(actor_name, actor)", "action", "action", "target", "coalesce(target_name, target)", "reason", "reason", "hash", "encode(hash, 'hex')");
        StringBuilder where = new StringBuilder(" WHERE true");
        java.util.Map<String, Object> bindings = new java.util.HashMap<>();
        if (!query.search().isBlank()) {
            where.append(" AND position(lower(:q) in lower(concat_ws(' ', actor_name, target_name, actor, target, action, reason, seq::text, at::text))) > 0");
            bindings.put("q", query.search());
        }
        int index = 0;
        for (var filter : query.filters().entrySet()) {
            String field = fields.get(filter.getKey());
            if (field == null) continue;
            String key = "f" + index++;
            where.append(" AND position(lower(:").append(key).append(") in lower(CAST(").append(field).append(" AS text))) > 0");
            bindings.put(key, filter.getValue());
        }
        if (!scope.getOrDefault("action", "").isBlank()) {
            where.append(" AND (action = :action OR starts_with(action, :action || '.') OR (:action = 'denied' AND starts_with(action, 'denied:')))"); bindings.put("action", scope.get("action"));
        }
        if (!scope.getOrDefault("user", "").isBlank()) {
            where.append(" AND EXISTS (SELECT 1 FROM unnest(string_to_array(:user, ',')) AS u WHERE position(u in actor) > 0 OR position(u in target) > 0)"); bindings.put("user", scope.get("user"));
        }
        for (String date : List.of("from", "to")) if (!scope.getOrDefault(date, "").isBlank()) {
            where.append(" AND at ").append(date.equals("from") ? ">=" : "<=").append(" :").append(date);
            try { bindings.put(date, OffsetDateTime.ofInstant(Instant.parse(scope.get(date)), ZoneOffset.UTC)); }
            catch (java.time.format.DateTimeParseException invalid) { throw new com.enclave.contracts.EnclaveException(com.enclave.contracts.ErrorCode.INVALID_REQUEST, "invalid audit date"); }
        }
        long count = jdbc.sql("SELECT count(*) FROM admin_audit" + where).params(bindings).query(Long.class).single();
        int page = Math.min(query.page(), Math.max(1, (int) ((count + query.size() - 1) / query.size())));
        String order = fields.getOrDefault(query.sort(), "seq") + (query.sort().isBlank() || query.descending() ? " DESC" : " ASC") + (query.sort().equals("seq") || query.sort().isBlank() ? "" : ", seq DESC");
        var rows = jdbc.sql("SELECT seq, at, actor, action, target, reason, hash, actor_name, target_name FROM admin_audit" + where + " ORDER BY " + order + " LIMIT :limit OFFSET :offset")
                .params(bindings).param("limit", query.size()).param("offset", (page - 1) * query.size())
                .query((rs, i) -> new AuditNames.View(rs.getLong(1), rs.getObject(2, OffsetDateTime.class).toInstant(), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), HexFormat.of().formatHex(rs.getBytes(7)), rs.getString(8), rs.getString(9))).list();
        return new AdminTableQuery.Page<>(rows, count, page, query.size(), List.of());
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
