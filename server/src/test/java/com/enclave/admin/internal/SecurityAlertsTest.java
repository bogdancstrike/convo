package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.enclave.contracts.EnclaveException;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;

class SecurityAlertsTest {
    private final Instant now=Instant.parse("2026-10-24T12:00:00Z");
    private final Clock clock=Clock.fixed(now,ZoneOffset.UTC);
    private final JdbcClient jdbc=mock(JdbcClient.class);
    private final SecurityAlerts alerts=mock(SecurityAlerts.class);
    private final IdentityAuditImporter importer=mock(IdentityAuditImporter.class);
    private final PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
    private final SecurityAlertProcessor processor=new SecurityAlertProcessor(jdbc,alerts,importer,clock,manager);
    private SecurityAlerts.Rule rule(String id,boolean enabled,int threshold) { return new SecurityAlerts.Rule(id,enabled,"high",threshold,5,true,now,"operator"); }
    @Test void onlyRelevantActionsCreateAlertsAndDisabledRulesDoNothing() {
        assertThat(SecurityAlertProcessor.ruleFor("auth.login.failed")).isEqualTo("failed-logins");
        assertThat(SecurityAlertProcessor.ruleFor("device.add")).isEqualTo("device-burst");
        assertThat(SecurityAlertProcessor.ruleFor("role.grant")).isEqualTo("role-grant");
        assertThat(SecurityAlertProcessor.ruleFor("role.revoke")).isEmpty();
        assertThat(SecurityAlertProcessor.ruleFor("auth.login")).isEmpty();
        processor.detect(new SecurityAlertProcessor.Signal(8,now,"actor","device.add","account.2","Alice","Bob"),Map.of("device-burst",rule("device-burst",false,3)));
        verifyNoInteractions(jdbc,alerts);
    }
    @Test void roleGrantUsesTheCommittedSequenceAsStableDeduplicationKey() {
        var rule=rule("role-grant",true,1);
        var signal=new SecurityAlertProcessor.Signal(42,now,"operator","role.grant","idp:bob convo-security","Ana","bob · Security");
        processor.detect(signal,Map.of("role-grant",rule)); processor.detect(signal,Map.of("role-grant",rule));
        verify(alerts,times(2)).record(eq(rule),eq("role-grant:idp:bob convo-security:42"),eq(signal.target()),eq("bob · Security"),contains("privileged"),eq(1L),eq(42L),eq(42L),eq(now),eq(now));
        verifyNoInteractions(jdbc);
    }
    @SuppressWarnings({"unchecked","rawtypes"})
    @Test void rollingThresholdsBindSourceTimeAndSequenceAndIgnoreBelowThreshold() {
        var sql=mock(JdbcClient.StatementSpec.class,RETURNS_SELF);
        JdbcClient.MappedQuerySpec<SecurityAlertProcessor.Window> result=mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(sql); when(sql.query(any(RowMapper.class))).thenReturn((JdbcClient.MappedQuerySpec)result);
        when(result.single()).thenReturn(new SecurityAlertProcessor.Window(4,10L,now.minusSeconds(120)),new SecurityAlertProcessor.Window(5,10L,now.minusSeconds(120)));
        var r=rule("failed-logins",true,5); var s=new SecurityAlertProcessor.Signal(20,now,"idp:bob (bob)","auth.login.failed","idp:bob","bob","bob");
        processor.detect(s,Map.of(r.id(),r)); verifyNoInteractions(alerts);
        processor.detect(s,Map.of(r.id(),r));
        verify(sql,times(2)).param("from",SecurityAlerts.date(now.minusSeconds(300)));
        verify(sql,times(2)).param("seq",20L);
        verify(alerts).record(eq(r),startsWith("failed-logins:idp:bob (bob):"),eq(s.actor()),eq("bob"),contains("5 failed sign-ins"),eq(5L),eq(10L),eq(20L),eq(now.minusSeconds(120)),eq(now));
    }
    @SuppressWarnings({"unchecked","rawtypes"})
    @Test void aContinuingBurstExtendsTheUnresolvedEpisodeInsteadOfOpeningAnotherAlert() {
        var sql=mock(JdbcClient.StatementSpec.class,RETURNS_SELF);
        JdbcClient.MappedQuerySpec<SecurityAlertProcessor.Window> result=mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(sql); when(sql.query(any(RowMapper.class))).thenReturn((JdbcClient.MappedQuerySpec)result);
        when(result.single()).thenReturn(new SecurityAlertProcessor.Window(7,10L,now.minusSeconds(200)));
        when(alerts.activeEpisode("failed-logins","idp:bob (bob)",now.minusSeconds(300))).thenReturn(Optional.of("failed-logins:idp:bob (bob):12"));
        var r=rule("failed-logins",true,5);
        processor.detect(new SecurityAlertProcessor.Signal(30,now,"idp:bob (bob)","auth.login.failed","idp:bob","bob","bob"),Map.of(r.id(),r));
        verify(alerts).record(eq(r),eq("failed-logins:idp:bob (bob):12"),anyString(),anyString(),anyString(),eq(7L),eq(10L),eq(30L),any(),eq(now));
    }
    @Test void failedBatchesRollBackAndExposeSafeProcessingError() {
        var tx=new org.springframework.transaction.support.SimpleTransactionStatus(); when(manager.getTransaction(any())).thenReturn(tx);
        when(jdbc.sql(anyString())).thenThrow(new IllegalStateException("database credentials must not leak"));
        processor.poll(); verify(manager).rollback(tx); verify(manager,never()).commit(any());
        assertThat(processor.error()).contains("retained for retry").doesNotContain("credentials");
    }
    @SuppressWarnings({"unchecked","rawtypes"})
    @Test void auditOutagesAreDetectedWithoutAnyNewIdentityEventsAndRecoveryResetsTheEpisode() {
        var sql=mock(JdbcClient.StatementSpec.class,RETURNS_SELF);
        JdbcClient.MappedQuerySpec<String> result=mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(sql); when(sql.query(any(RowMapper.class))).thenReturn((JdbcClient.MappedQuerySpec)result);
        when(result.single()).thenReturn("existing-outage");
        var r=rule("audit-sync",true,1);
        when(importer.status()).thenReturn(new IdentityAuditImporter.Status(true,now.minusSeconds(600),"sync failed"));
        processor.auditSource(r);
        verify(alerts).record(eq(r),eq("existing-outage"),eq("system:identity-audit"),anyString(),contains("synchronized"),eq(1L),isNull(),isNull(),eq(now.minusSeconds(600)),eq(now));
        reset(alerts); when(importer.status()).thenReturn(new IdentityAuditImporter.Status(true,now,null));
        processor.auditSource(r); verifyNoInteractions(alerts);
        verify(jdbc).sql("UPDATE admin_alert_cursor SET outage_key=NULL WHERE id=1");
    }

    @Test void invalidRulesCannotTouchPersistence() {
        var store=new SecurityAlerts(jdbc,clock,mock(AuditLog.class));
        assertThatThrownBy(()->store.updateRule("failed-logins",true,"high",0,5,true,"op","test")).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(()->store.updateRule("failed-logins",true,"unknown",5,5,true,"op","test")).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(()->store.updateRule("audit-sync",true,"high",2,5,true,"op","test")).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(()->store.updateRule("role-grant",true,"high",1,5,true,"op","test")).isInstanceOf(EnclaveException.class);
        verifyNoInteractions(jdbc);
    }

    @SuppressWarnings({"unchecked","rawtypes"})
    @Test void resolveAllChangesOnlyMatchingUnresolvedAlertsWithHistoryAndOneAuditEntry() {
        var audit=mock(AuditLog.class); var store=new SecurityAlerts(jdbc,clock,audit);
        var sql=mock(JdbcClient.StatementSpec.class,RETURNS_SELF);
        when(jdbc.sql(anyString())).thenReturn(sql); when(sql.update()).thenReturn(3);
        var query=AdminTableQuery.from(Map.of("q","bob","f_title","failed"));
        long count=store.resolveAll(query,Map.of("status","all","severity","high","ruleId","all","q","bob"),"op","  ");
        assertThat(count).isEqualTo(3);
        var statement=org.mockito.ArgumentCaptor.forClass(String.class); verify(jdbc).sql(statement.capture());
        assertThat(statement.getValue()).contains("UPDATE admin_security_alert SET status='resolved'").contains("AND status IN ('open','acknowledged')").contains("SELECT id,:at,:actor,'resolved',:reason").contains("INSERT INTO admin_alert_history").contains("severity = :severity").doesNotContain("rule_id = :ruleId").doesNotContain("status = :status");
        var bindings=org.mockito.ArgumentCaptor.forClass(Map.class); verify(sql).params(bindings.capture());
        assertThat((Map<String,Object>)bindings.getValue()).containsEntry("q","bob").containsEntry("severity","high").containsEntry("f0","failed");
        verify(sql).param("reason",SecurityAlerts.NO_REASON);
        verify(audit,times(1)).append(eq("op"),eq("alert.resolve-all"),eq("alerts"),argThat((String r)->r.startsWith(SecurityAlerts.NO_REASON) && r.contains("count=3") && r.contains("severity=high") && !r.contains("ruleId")));
    }
    @SuppressWarnings({"unchecked","rawtypes"})
    @Test void resolvingWithoutAReasonRecordsTheDefaultReason() {
        var audit=mock(AuditLog.class); var store=new SecurityAlerts(jdbc,clock,audit);
        var sql=mock(JdbcClient.StatementSpec.class,RETURNS_SELF); JdbcClient.MappedQuerySpec<String> current=mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(sql); when(sql.query(String.class)).thenReturn((JdbcClient.MappedQuerySpec)current); when(current.optional()).thenReturn(Optional.of("open"));
        var id=UUID.randomUUID();
        store.transition(id,"resolved","op",null);
        verify(sql).param("reason",SecurityAlerts.NO_REASON);
        verify(audit).append("op","alert.resolve","alert:"+id,SecurityAlerts.NO_REASON);
        store.transition(id,"resolved","op"," confirmed ");
        verify(audit).append("op","alert.resolve","alert:"+id,"confirmed");
    }
    @Test void transitionReasonIsOptionalButBounded() {
        try (var factory=jakarta.validation.Validation.buildDefaultValidatorFactory()) {
            var validator=factory.getValidator();
            assertThat(validator.validate(new SecurityAlertsController.Transition("resolved",null))).isEmpty();
            assertThat(validator.validate(new SecurityAlertsController.Transition("resolved",""))).isEmpty();
            assertThat(validator.validate(new SecurityAlertsController.Transition("resolved","x".repeat(501)))).isNotEmpty();
            assertThat(validator.validate(new SecurityAlertsController.BulkResolve(null))).isEmpty();
            assertThat(validator.validate(new SecurityAlertsController.RuleUpdate(true,"high",5,5,true," "))).isNotEmpty();
        }
    }
}
