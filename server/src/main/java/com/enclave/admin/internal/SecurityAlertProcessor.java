package com.enclave.admin.internal;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Bounded, transactional projection. Multiple replicas serialize on the cursor; no retention job. */
@Component
class SecurityAlertProcessor {
    record Signal(long seq, Instant at, String actor, String action, String target, String actorName, String targetName) {}
    record Window(long count, Long firstSeq, Instant firstAt) {}
    private final JdbcClient jdbc;
    private final SecurityAlerts alerts;
    private final IdentityAuditImporter importer;
    private final Clock clock;
    private final Instant started;
    private final TransactionTemplate transaction;
    private volatile String error;
    SecurityAlertProcessor(JdbcClient jdbc, SecurityAlerts alerts, IdentityAuditImporter importer, Clock clock, PlatformTransactionManager manager) {
        this.jdbc=jdbc; this.alerts=alerts; this.importer=importer; this.clock=clock; this.started=clock.instant(); this.transaction=new TransactionTemplate(manager);
    }
    String error() { return error; }
    @Scheduled(fixedDelayString="${enclave.admin.alert-poll-interval:PT15S}",initialDelayString="PT10S")
    void poll() {
        try { transaction.executeWithoutResult(tx->process()); error=null; }
        catch (RuntimeException failure) {
            error="Security alert processing failed; the cursor is retained for retry.";
            org.slf4j.LoggerFactory.getLogger(getClass()).warn("Security alert processing failed ({})",failure.getClass().getSimpleName());
        }
    }
    void process() {
        long cursor=jdbc.sql("SELECT through_seq FROM admin_alert_cursor WHERE id=1 FOR UPDATE").query(Long.class).single();
        Map<String,SecurityAlerts.Rule> rules=alerts.rules().stream().collect(Collectors.toMap(SecurityAlerts.Rule::id,r->r));
        var signals=jdbc.sql("SELECT seq,at,actor,action,target,actor_name,target_name FROM admin_audit WHERE seq>:cursor ORDER BY seq LIMIT 1000").param("cursor",cursor)
                .query((r,n)->new Signal(r.getLong("seq"),SecurityAlerts.time(r,"at"),r.getString("actor"),r.getString("action"),r.getString("target"),r.getString("actor_name"),r.getString("target_name"))).list();
        for (var signal:signals) detect(signal,rules);
        auditSource(rules.get("audit-sync"));
        long next=signals.isEmpty()?cursor:signals.getLast().seq();
        jdbc.sql("UPDATE admin_alert_cursor SET through_seq=:seq,last_success=:at WHERE id=1").param("seq",next).param("at",SecurityAlerts.date(clock.instant())).update();
    }
    void detect(Signal signal, Map<String,SecurityAlerts.Rule> rules) {
        String ruleId=ruleFor(signal.action());
        var rule=rules.get(ruleId);
        if (rule==null || !rule.enabled()) return;
        boolean login=ruleId.equals("failed-logins");
        String subject=login?signal.actor():ruleId.equals("device-burst")?signal.target().split("\\.",2)[0]:signal.target();
        String name=login?signal.actorName():signal.targetName();
        if (name==null || name.isBlank()) name=subject;
        Window window;
        if (ruleId.equals("role-grant")) window=new Window(1,signal.seq(),signal.at());
        else {
            // Compare source timestamps, bounded by the committed sequence being processed.
            String match=login?"actor = :subject":"split_part(target, '.', 1) = :subject";
            window=jdbc.sql("SELECT count(*),min(seq),min(at) AS first_at FROM admin_audit WHERE action=:action AND "+match+" AND at>:from AND at<=:to AND seq<=:seq")
                    .param("action",signal.action()).param("subject",subject).param("from",SecurityAlerts.date(signal.at().minusSeconds(rule.windowMinutes()*60L))).param("to",SecurityAlerts.date(signal.at())).param("seq",signal.seq())
                    .query((r,n)->new Window(r.getLong(1),r.getObject(2,Long.class),SecurityAlerts.time(r,"first_at"))).single();
        }
        if (window.count()<rule.threshold()) return;
        // Threshold rules extend one unresolved episode while events keep arriving within the window;
        // a fixed time bucket would split a single burst into several alerts at bucket boundaries.
        String key=ruleId.equals("role-grant")?ruleId+":"+subject+":"+signal.seq()
                :alerts.activeEpisode(ruleId,subject,signal.at().minusSeconds(rule.windowMinutes()*60L)).orElse(ruleId+":"+subject+":"+signal.seq());
        String detail=ruleId.equals("role-grant")?"An administrator granted a privileged Convo role. Review the granting actor and justification in the audit evidence."
                :window.count()+" "+(login?"failed sign-ins":"device enrollments")+" in the preceding "+rule.windowMinutes()+" minutes. Review the events before taking action.";
        alerts.record(rule,key,subject,name,detail,window.count(),window.firstSeq(),signal.seq(),window.firstAt(),signal.at());
    }
    void auditSource(SecurityAlerts.Rule rule) {
        if (rule==null || !rule.enabled()) return;
        var status=importer.status();
        Instant last=status.lastSuccess()==null?started:status.lastSuccess();
        boolean failed=!status.configured() || status.error()!=null || last.plusSeconds(rule.windowMinutes()*60L).isBefore(clock.instant());
        if (!failed || last.plusSeconds(rule.windowMinutes()*60L).isAfter(clock.instant())) {
            jdbc.sql("UPDATE admin_alert_cursor SET outage_key=NULL WHERE id=1").update(); return;
        }
        String key=jdbc.sql("SELECT outage_key FROM admin_alert_cursor WHERE id=1").query((r,n)->r.getString(1)).single();
        if (key==null) {
            key="audit-sync:"+UUID.randomUUID();
            jdbc.sql("UPDATE admin_alert_cursor SET outage_key=:key WHERE id=1").param("key",key).update();
        }
        alerts.record(rule,key,"system:identity-audit","Identity audit collector","Identity events have not synchronized successfully within "+rule.windowMinutes()+" minutes. Check Keycloak availability, event storage and view-events access.",1,null,null,last,clock.instant());
    }
    static String ruleFor(String action) {
        return switch(action) { case "auth.login.failed"->"failed-logins"; case "device.add"->"device-burst"; case "role.grant"->"role-grant"; default->""; };
    }
}
