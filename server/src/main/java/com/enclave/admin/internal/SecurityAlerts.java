package com.enclave.admin.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Durable inbox and configuration. Resolved/disabled alerts and their evidence are retained. */
@Service
class SecurityAlerts {
    static final Map<String, String> LABELS = Map.of("failed-logins", "Repeated failed logins", "device-burst", "Device enrollment burst", "role-grant", "Privileged role granted", "audit-sync", "Identity audit sync unavailable");
    static final Set<String> SEVERITIES = Set.of("critical", "high", "medium", "low");
    record Rule(String id, boolean enabled, String severity, int threshold, int windowMinutes, boolean notificationsEnabled, Instant updatedAt, String updatedBy) {}
    record Alert(UUID id, String ruleId, String severity, String status, String title, String subject, String subjectName, String detail,
            long occurrences, Long firstSeq, Long lastSeq, Instant firstSeen, Instant lastSeen, Instant createdAt, Instant updatedAt) {}
    record History(long id, Instant at, String actor, String status, String reason) {}
    record Detail(Alert alert, List<History> history) {}
    record Summary(long open, long acknowledged, long critical, long notifications, Instant processedAt, String error, List<Alert> recent) {}
    private final JdbcClient jdbc;
    private final Clock clock;
    private final AuditLog audit;
    SecurityAlerts(JdbcClient jdbc, Clock clock, AuditLog audit) { this.jdbc = jdbc; this.clock = clock; this.audit = audit; }
    List<Rule> rules() { return jdbc.sql("SELECT * FROM admin_alert_rule ORDER BY id").query((r,n) -> rule(r)).list(); }
    static Rule rule(ResultSet r) throws SQLException { return new Rule(r.getString("id"), r.getBoolean("enabled"), r.getString("severity"), r.getInt("threshold"), r.getInt("window_minutes"), r.getBoolean("notify"), time(r,"updated_at"), r.getString("updated_by")); }
    static Alert alert(ResultSet r) throws SQLException {
        return new Alert(r.getObject("id", UUID.class), r.getString("rule_id"), r.getString("severity"), r.getString("status"), r.getString("title"), r.getString("subject"), r.getString("subject_name"), r.getString("detail"),
                r.getLong("occurrences"), r.getObject("first_seq", Long.class), r.getObject("last_seq", Long.class), time(r,"first_seen"), time(r,"last_seen"), time(r,"created_at"), time(r,"updated_at"));
    }
    static Instant time(ResultSet r, String key) throws SQLException { var v = r.getObject(key, OffsetDateTime.class); return v == null ? null : v.toInstant(); }
    static OffsetDateTime date(Instant instant) { return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC); }
    @Transactional(readOnly = true) Detail detail(UUID id) {
        var a = jdbc.sql("SELECT * FROM admin_security_alert WHERE id = :id").param("id", id).query((r,n) -> alert(r)).optional()
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown security alert"));
        var history = jdbc.sql("SELECT * FROM admin_alert_history WHERE alert_id = :id ORDER BY id DESC LIMIT 100").param("id", id)
                .query((r,n) -> new History(r.getLong("id"), time(r,"at"), r.getString("actor"), r.getString("status"), r.getString("reason"))).list();
        return new Detail(a, history);
    }
    private static final Map<String, String> FIELDS = Map.ofEntries(Map.entry("title","title"),Map.entry("ruleId","rule_id"),Map.entry("severity","severity"),Map.entry("status","status"),Map.entry("subjectName","subject_name"),Map.entry("occurrences","occurrences"),Map.entry("createdAt","created_at"),Map.entry("lastSeen","last_seen"));
    /** Reason stored in history and audit when an operator leaves the optional reason empty. */
    static final String NO_REASON = "No reason given";
    record Filter(String sql, Map<String, Object> bindings) {}
    /** The inbox's search, column filters and status/severity/rule scope as a bound WHERE clause; shared by the table and bulk resolve. */
    static Filter filter(AdminTableQuery q, Map<String, String> scope) {
        StringBuilder where = new StringBuilder(" WHERE true"); Map<String, Object> bindings = new HashMap<>();
        if (!q.search().isBlank()) { where.append(" AND position(lower(:q) in lower(concat_ws(' ', title, subject_name, detail, rule_id, severity, status))) > 0"); bindings.put("q",q.search()); }
        int i=0;
        for (var f : q.filters().entrySet()) if (FIELDS.containsKey(f.getKey())) { String key="f"+i++; where.append(" AND position(lower(:").append(key).append(") in lower(CAST(").append(FIELDS.get(f.getKey())).append(" AS text))) > 0"); bindings.put(key,f.getValue()); }
        for (String field : List.of("status","severity","ruleId")) { String value=scope.getOrDefault(field,""); if (!value.isBlank() && !value.equals("all")) { where.append(" AND ").append(FIELDS.get(field)).append(" = :").append(field); bindings.put(field,value); } }
        return new Filter(where.toString(), bindings);
    }
    static String reason(String reason) { return reason==null || reason.isBlank() ? NO_REASON : reason.strip(); }
    @Transactional AdminTableQuery.Page<Alert> table(AdminTableQuery q, Map<String, String> scope) {
        var filter=filter(q,scope); String where=filter.sql(); Map<String,Object> bindings=filter.bindings();
        long total=jdbc.sql("SELECT count(*) FROM admin_security_alert"+where).params(bindings).query(Long.class).single();
        int page=Math.min(q.page(),Math.max(1,(int)((total+q.size()-1)/q.size())));
        String sort=FIELDS.getOrDefault(q.sort(),"created_at");
        if (q.sort().equals("severity")) sort="CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END";
        var rows=jdbc.sql("SELECT * FROM admin_security_alert"+where+" ORDER BY "+sort+(q.sort().isBlank() || q.descending()?" DESC":" ASC")+", id LIMIT :limit OFFSET :offset")
                .params(bindings).param("limit",q.size()).param("offset",(page-1)*q.size()).query((r,n)->alert(r)).list();
        return new AdminTableQuery.Page<>(rows,total,page,q.size(),List.of());
    }
    Summary summary(String error) {
        var counts=jdbc.sql("SELECT count(*) FILTER (WHERE status='open'), count(*) FILTER (WHERE status='acknowledged'), count(*) FILTER (WHERE status<>'resolved' AND severity='critical') FROM admin_security_alert")
                .query((r,n)->new long[]{r.getLong(1),r.getLong(2),r.getLong(3)}).single();
        long notifications=jdbc.sql("SELECT count(*) FROM admin_security_alert a JOIN admin_alert_rule r ON r.id=a.rule_id WHERE a.status='open' AND r.enabled AND r.notify").query(Long.class).single();
        var recent=jdbc.sql("SELECT a.* FROM admin_security_alert a JOIN admin_alert_rule r ON r.id=a.rule_id WHERE a.status='open' AND r.enabled AND r.notify ORDER BY a.created_at DESC LIMIT 20").query((r,n)->alert(r)).list();
        Instant processed=jdbc.sql("SELECT last_success FROM admin_alert_cursor WHERE id=1").query((r,n)->time(r,"last_success")).single();
        return new Summary(counts[0],counts[1],counts[2],notifications,processed,error,recent);
    }
    @Transactional void transition(UUID id, String status, String actor, String reason) {
        if (!Set.of("open","acknowledged","resolved").contains(status)) throw new EnclaveException(ErrorCode.INVALID_REQUEST,"unsupported alert status");
        var current=jdbc.sql("SELECT status FROM admin_security_alert WHERE id=:id FOR UPDATE").param("id",id).query(String.class).optional()
                .orElseThrow(()->new EnclaveException(ErrorCode.NOT_FOUND,"unknown security alert"));
        if (current.equals(status)) return;
        reason=reason(reason);
        jdbc.sql("UPDATE admin_security_alert SET status=:status, updated_at=:at WHERE id=:id").param("id",id).param("status",status).param("at",date(clock.instant())).update();
        history(id,actor,status,reason);
        audit.append(actor,"alert."+(status.equals("open")?"reopen":status.equals("acknowledged")?"acknowledge":"resolve"),"alert:"+id,reason);
    }
    /**
     * Resolves every unresolved (open or acknowledged) alert matching the inbox filter in one statement:
     * each changed alert gets a history row, and the bulk action is audited once with its count.
     * Returns the number resolved.
     */
    @Transactional long resolveAll(AdminTableQuery q, Map<String, String> scope, String actor, String reason) {
        var filter=filter(q,scope); String why=reason(reason);
        long count=jdbc.sql("WITH changed AS (UPDATE admin_security_alert SET status='resolved', updated_at=:at"+filter.sql()+" AND status IN ('open','acknowledged') RETURNING id) "
                +"INSERT INTO admin_alert_history(alert_id,at,actor,status,reason) SELECT id,:at,:actor,'resolved',:reason FROM changed")
                .params(filter.bindings()).param("at",date(clock.instant())).param("actor",actor).param("reason",why).update();
        String scoped=List.of("status","severity","ruleId").stream().filter(k->!scope.getOrDefault(k,"").isBlank() && !scope.get(k).equals("all")).map(k->k+"="+scope.get(k)).collect(Collectors.joining(", "));
        audit.append(actor,"alert.resolve-all","alerts",why+" [count="+count+(q.search().isBlank()?"":", search="+q.search())+(scoped.isEmpty()?"":", "+scoped)+(q.filters().isEmpty()?"":", filters="+q.filters())+"]");
        return count;
    }
    @Transactional void updateRule(String id, boolean enabled, String severity, int threshold, int minutes, boolean notificationsEnabled, String actor, String reason) {
        if (!LABELS.containsKey(id) || !SEVERITIES.contains(severity) || threshold<1 || threshold>1000 || minutes<1 || minutes>1440 || (id.equals("role-grant") || id.equals("audit-sync")) && threshold!=1 || id.equals("role-grant") && minutes!=1)
            throw new EnclaveException(ErrorCode.INVALID_REQUEST,"invalid alert rule values");
        jdbc.sql("UPDATE admin_alert_rule SET enabled=:enabled,severity=:severity,threshold=:threshold,window_minutes=:minutes,notify=:notify,updated_at=:at,updated_by=:actor WHERE id=:id")
                .param("enabled",enabled).param("severity",severity).param("threshold",threshold).param("minutes",minutes).param("notify",notificationsEnabled).param("at",date(clock.instant())).param("actor",actor).param("id",id).update();
        audit.append(actor,"alert.rule-update","alert-rule:"+id,reason+" [enabled="+enabled+", severity="+severity+", threshold="+threshold+", windowMinutes="+minutes+", notify="+notificationsEnabled+"]");
    }
    /** Deduplication key of the unresolved alert for this rule and subject whose latest event is after {@code since}. */
    Optional<String> activeEpisode(String ruleId,String subject,Instant since) {
        return jdbc.sql("SELECT dedup_key FROM admin_security_alert WHERE rule_id=:rule AND subject=:subject AND status<>'resolved' AND last_seen>=:since ORDER BY last_seen DESC LIMIT 1")
                .param("rule",ruleId).param("subject",subject).param("since",date(since)).query(String.class).optional();
    }
    void record(Rule rule,String key,String subject,String name,String detail,long count,Long firstSeq,Long lastSeq,Instant first,Instant last) {
        UUID id=UUID.randomUUID();
        int added=jdbc.sql("""
            INSERT INTO admin_security_alert(id,dedup_key,rule_id,severity,title,subject,subject_name,detail,occurrences,first_seq,last_seq,first_seen,last_seen,created_at,updated_at)
            VALUES (:id,:key,:rule,:severity,:title,:subject,:name,:detail,:count,:firstSeq,:lastSeq,:first,:last,:at,:at) ON CONFLICT (dedup_key) DO NOTHING
            """).param("id",id).param("key",key).param("rule",rule.id()).param("severity",rule.severity()).param("title",LABELS.get(rule.id())).param("subject",subject).param("name",name).param("detail",detail).param("count",count).param("firstSeq",firstSeq).param("lastSeq",lastSeq).param("first",date(first)).param("last",date(last)).param("at",date(clock.instant())).update();
        if (added>0) history(id,"system","open","Detected by "+LABELS.get(rule.id()));
        else jdbc.sql("UPDATE admin_security_alert SET occurrences=greatest(occurrences,:count),last_seq=:lastSeq,last_seen=greatest(last_seen,:last),updated_at=:at WHERE dedup_key=:key")
                .param("count",count).param("lastSeq",lastSeq).param("last",date(last)).param("at",date(clock.instant())).param("key",key).update();
    }
    private void history(UUID id,String actor,String status,String reason) {
        jdbc.sql("INSERT INTO admin_alert_history(alert_id,at,actor,status,reason) VALUES (:id,:at,:actor,:status,:reason)").param("id",id).param("at",date(clock.instant())).param("actor",actor).param("status",status).param("reason",reason).update();
    }
}
