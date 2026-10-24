package com.enclave.admin.internal;

import static com.enclave.admin.internal.AdminPermissions.Permission.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

/** Security alerts inbox: read (security/auditor), lifecycle changes and rule edits, each separately scoped and audited. */
@RestController
@RequestMapping("/v1/admin")
class SecurityAlertsController {
    record Transition(@NotBlank String status,@Size(max=500) String reason) {}
    record BulkResolve(@Size(max=500) String reason) {}
    record BulkResult(long resolved) {}
    record RuleUpdate(boolean enabled,@NotBlank String severity,@Min(1) @Max(1000) int threshold,@Min(1) @Max(1440) int windowMinutes,boolean notificationsEnabled,@NotBlank @Size(max=500) String reason) {}
    private final AdminGuard guard;
    private final SecurityAlerts alerts;
    private final SecurityAlertProcessor processor;
    SecurityAlertsController(AdminGuard guard,SecurityAlerts alerts,SecurityAlertProcessor processor) { this.guard=guard; this.alerts=alerts; this.processor=processor; }
    @GetMapping("/tables/alerts") ResponseEntity<AdminTableQuery.Page<SecurityAlerts.Alert>> table(@AuthenticationPrincipal Jwt admin,@RequestParam Map<String,String> params) {
        guard.require(admin,ALERTS_READ); return noStore(alerts.table(AdminTableQuery.from(params),params));
    }
    @GetMapping("/alerts/summary") ResponseEntity<SecurityAlerts.Summary> summary(@AuthenticationPrincipal Jwt admin) {
        guard.require(admin,ALERTS_READ); return noStore(alerts.summary(processor.error()));
    }
    @GetMapping("/alerts/rules") ResponseEntity<List<SecurityAlerts.Rule>> rules(@AuthenticationPrincipal Jwt admin) {
        guard.require(admin,ALERTS_READ); return noStore(alerts.rules());
    }
    @GetMapping("/alerts/{id}") ResponseEntity<SecurityAlerts.Detail> detail(@AuthenticationPrincipal Jwt admin,@PathVariable UUID id) {
        guard.require(admin,ALERTS_READ); return noStore(alerts.detail(id));
    }
    @PostMapping("/alerts/{id}/status") ResponseEntity<SecurityAlerts.Detail> transition(@AuthenticationPrincipal Jwt admin,@PathVariable UUID id,@Valid @RequestBody Transition body) {
        guard.requireAudited(admin,ALERTS_MANAGE,"alert.status","alert:"+id);
        alerts.transition(id,body.status(),guard.actor(admin),body.reason()); return noStore(alerts.detail(id));
    }
    /** Resolves all open and acknowledged alerts matching the inbox search/filters/scope (same query parameters as the table). */
    @PostMapping("/alerts/resolve-all") ResponseEntity<BulkResult> resolveAll(@AuthenticationPrincipal Jwt admin,@RequestParam Map<String,String> params,@Valid @RequestBody(required=false) BulkResolve body) {
        guard.requireAudited(admin,ALERTS_MANAGE,"alert.resolve-all","alerts");
        return noStore(new BulkResult(alerts.resolveAll(AdminTableQuery.from(params),params,guard.actor(admin),body==null?null:body.reason())));
    }
    @PostMapping("/alerts/rules/{id}") ResponseEntity<List<SecurityAlerts.Rule>> rule(@AuthenticationPrincipal Jwt admin,@PathVariable String id,@Valid @RequestBody RuleUpdate body) {
        guard.requireAudited(admin,ALERT_RULES_MANAGE,"alert.rule-update","alert-rule:"+id); guard.requireRecentSignIn(admin);
        alerts.updateRule(id,body.enabled(),body.severity(),body.threshold(),body.windowMinutes(),body.notificationsEnabled(),guard.actor(admin),body.reason()); return noStore(alerts.rules());
    }
    private static <T> ResponseEntity<T> noStore(T body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
}
