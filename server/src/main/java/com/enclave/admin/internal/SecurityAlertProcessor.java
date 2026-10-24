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
    /** Evaluates one audit entry against every enabled rule that reads its action. */
    void detect(Signal signal, Map<String,SecurityAlerts.Rule> rules) {
        for (String ruleId:rulesFor(signal.action())) {
            var rule=rules.get(ruleId);
            if (rule!=null && rule.enabled()) detect(signal,SecurityAlerts.DEFINITIONS.get(ruleId),rule);
        }
    }
    private void detect(Signal signal, SecurityAlerts.Definition definition, SecurityAlerts.Rule rule) {
        var kind=definition.kind();
        if (kind==SecurityAlerts.Kind.OFF_HOURS && (rule.businessHours()==null || rule.businessHours().contains(signal.at()))) return;
        boolean byTarget=kind==SecurityAlerts.Kind.TARGET_BURST || definition.id().equals("role-grant");
        String subject=kind==SecurityAlerts.Kind.TARGET_BURST?signal.target().split("\\.",2)[0]:byTarget?signal.target():signal.actor();
        String name=byTarget?signal.targetName():signal.actorName();
        if (name==null || name.isBlank()) name=subject;
        Window window;
        if (kind==SecurityAlerts.Kind.EVENT) window=new Window(1,signal.seq(),signal.at());
        else {
            // Compare source timestamps, bounded by the committed sequence being processed.
            String match=byTarget?"split_part(target, '.', 1) = :subject":"actor = :subject";
            window=jdbc.sql("SELECT count(*),min(seq),min(at) AS first_at FROM admin_audit WHERE action IN (:actions) AND "+match+" AND at>:from AND at<=:to AND seq<=:seq")
                    .param("actions",List.copyOf(definition.actions())).param("subject",subject).param("from",SecurityAlerts.date(signal.at().minusSeconds(rule.windowMinutes()*60L))).param("to",SecurityAlerts.date(signal.at())).param("seq",signal.seq())
                    .query((r,n)->new Window(r.getLong(1),r.getObject(2,Long.class),SecurityAlerts.time(r,"first_at"))).single();
        }
        if (window.count()<rule.threshold()) return;
        // Windowed rules extend one unresolved episode while events keep arriving within the window;
        // a fixed time bucket would split a single burst into several alerts at bucket boundaries.
        String key=kind==SecurityAlerts.Kind.EVENT?rule.id()+":"+subject+":"+signal.seq()
                :alerts.activeEpisode(rule.id(),subject,signal.at().minusSeconds(rule.windowMinutes()*60L)).orElse(rule.id()+":"+subject+":"+signal.seq());
        alerts.record(rule,key,subject,name,detail(definition,rule,window.count()),window.count(),window.firstSeq(),signal.seq(),window.firstAt(),signal.at());
    }
    static String detail(SecurityAlerts.Definition definition, SecurityAlerts.Rule rule, long count) {
        return switch (definition.id()) {
            case "role-grant" -> "An administrator granted a privileged Convo role. Review the granting actor and justification in the audit evidence.";
            case "audit-export" -> "An administrator exported the audit log. Confirm the export was expected and that the file is stored securely.";
            case "off-hours-admin" -> count+" privileged admin "+(count==1?"action":"actions")+" in the preceding "+rule.windowMinutes()+" minutes, starting outside business hours ("
                    +rule.businessHours().startHour()+":00–"+rule.businessHours().endHour()+":00 UTC). Confirm the administrator was expected to work at this time.";
            default -> count+" "+definition.counted()+" in the preceding "+rule.windowMinutes()+" minutes. Review the events before taking action.";
        };
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
    /** Rules that read this audit action; off-hours detection reads every privileged action in addition to its specific rule. */
    static List<String> rulesFor(String action) {
        return SecurityAlerts.DEFINITIONS.values().stream().filter(d->d.actions().contains(action)).map(SecurityAlerts.Definition::id).toList();
    }
}
