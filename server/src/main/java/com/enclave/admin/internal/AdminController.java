package com.enclave.admin.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.IdentityAdminApi;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

/**
 * Administrator API ({@code /v1/admin/**}, Keycloak token with an admin realm role; the security
 * chain admits any admin role and each endpoint checks its scoped permission, see
 * {@link AdminPermissions}). State-changing actions require a reason and commit with their audit
 * entry; denied sensitive attempts are audited too.
 */
@RestController
@RequestMapping("/v1/admin")
class AdminController {
    record Reason(@NotBlank @Size(max = 500) String reason) {}

    private final IdentityAdminApi identity;
    private final AuditLog audit;
    private final AuditNames names;
    private final AdminActions actions;
    private final AuditCheckpoints checkpoints;

    private final AdminProperties properties;
    private final java.time.Clock clock;
    private final AdminPermissions permissions;
    private final com.enclave.push.PushApi push;

    /** This admin's roles and permissions (the console shows only what is allowed). */
    record Me(String actor, List<String> roles, java.util.Set<AdminPermissions.Permission> permissions) {}

    /** Audit export: the full chain with its head; the export itself is audited first. */
    record AuditExport(String exportedBy, java.time.Instant exportedAt, AuditLog.FullVerification verification, List<AuditLog.Entry> entries) {}

    AdminController(IdentityAdminApi identity, AuditLog audit, AuditNames names, AdminActions actions, AuditCheckpoints checkpoints, AdminProperties properties, java.time.Clock clock,
            AdminPermissions permissions, com.enclave.push.PushApi push) {
        this.push = push;
        this.permissions = permissions;
        this.checkpoints = checkpoints;
        this.properties = properties;
        this.clock = clock;
        this.identity = identity;
        this.audit = audit;
        this.names = names;
        this.actions = actions;
    }

    @GetMapping("/me")
    Me me(@AuthenticationPrincipal Jwt admin) {
        // The console calls this first after every sign-in: record the admin session once per token.
        String session = admin.getClaimAsString("sid") != null ? admin.getClaimAsString("sid") : admin.getId();
        if (!permissions.of(admin).isEmpty() && session != null && seenSessions.add(session)) {
            audit.append(actor(admin), "admin.session", "console", "signed in (" + String.join(", ", permissions.roles(admin)) + ")");
        }
        return new Me(actor(admin), permissions.roles(admin), permissions.of(admin));
    }

    /** IdP sessions already recorded (bounded; a restart may record a session once more). */
    private final java.util.Set<String> seenSessions = java.util.Collections.synchronizedSet(java.util.Collections.newSetFromMap(new java.util.LinkedHashMap<>() {
        @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, Boolean> eldest) { return size() > 10_000; }
    }));

    @GetMapping("/accounts")
    List<IdentityAdminApi.AccountSummary> accounts(@AuthenticationPrincipal Jwt admin, @RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "50") int limit) {
        require(admin, AdminPermissions.Permission.ACCOUNTS_READ);
        return identity.searchAccounts(q, limit);
    }

    @GetMapping("/accounts/{accountId}")
    IdentityAdminApi.AccountSummary account(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId) {
        require(admin, AdminPermissions.Permission.ACCOUNTS_READ);
        return identity.account(accountId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown account"));
    }

    @GetMapping("/accounts/{accountId}/devices")
    List<IdentityAdminApi.DeviceSummary> devices(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId) {
        require(admin, AdminPermissions.Permission.DEVICES_READ);
        requireAccount(accountId);
        return identity.devices(accountId);
    }

    @PostMapping("/accounts/{accountId}/disable")
    AuditLog.Entry disable(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @Valid @RequestBody Reason body) {
        requireAudited(admin, AdminPermissions.Permission.ACCOUNT_STATUS, "account.disable", accountId.toString());
        requireRecentSignIn(admin);
        return actions.setDisabled(actor(admin), accountId, true, body.reason());
    }

    @PostMapping("/accounts/{accountId}/enable")
    AuditLog.Entry enable(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @Valid @RequestBody Reason body) {
        requireAudited(admin, AdminPermissions.Permission.ACCOUNT_STATUS, "account.enable", accountId.toString());
        requireRecentSignIn(admin);
        return actions.setDisabled(actor(admin), accountId, false, body.reason());
    }

    /** @param kind {@code archive}, {@code bot} or null to clear; @param retention disclosed to chat members */
    record IntegrationRequest(@jakarta.validation.constraints.Pattern(regexp = "archive|bot") String kind, @Size(max = 200) String retention,
                              @NotBlank @Size(max = 500) String reason) {}

    /** @param integration the mark, or null for an ordinary account */
    record IntegrationView(IdentityAdminApi.Integration integration) {}

    @GetMapping("/accounts/{accountId}/integration")
    IntegrationView integration(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId) {
        require(admin, AdminPermissions.Permission.ACCOUNTS_READ);
        return new IntegrationView(identity.integration(accountId).orElse(null));
    }

    /** Marks or clears a visible archive/bot integration account (audited, recent sign-in). */
    @PutMapping("/accounts/{accountId}/integration")
    AuditLog.Entry setIntegration(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @Valid @RequestBody IntegrationRequest body) {
        requireAudited(admin, AdminPermissions.Permission.INTEGRATIONS_MANAGE, body.kind() == null ? "integration.clear" : "integration.set", accountId.toString());
        requireRecentSignIn(admin);
        return actions.setIntegration(actor(admin), accountId, body.kind(), body.retention(), body.reason());
    }

    @PostMapping("/accounts/{accountId}/devices/{deviceId}/revoke")
    AuditLog.Entry revoke(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @PathVariable int deviceId, @Valid @RequestBody Reason body) {
        requireAudited(admin, AdminPermissions.Permission.DEVICE_REVOKE, "device.revoke", accountId + "." + deviceId);
        requireRecentSignIn(admin);
        return actions.revokeDevice(actor(admin), accountId, deviceId, body.reason());
    }

    @GetMapping("/audit")
    ResponseEntity<List<AuditNames.View>> audit(@AuthenticationPrincipal Jwt admin, @RequestParam(defaultValue = "9223372036854775807") long before, @RequestParam(defaultValue = "100") int limit,
            @RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "") String action,
            @RequestParam(defaultValue = "") String user, @RequestParam(required = false) java.time.Instant from,
            @RequestParam(required = false) java.time.Instant to) {
        require(admin, AdminPermissions.Permission.AUDIT_READ);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(names.resolve(audit.search(before, limit, q, action, user, from, to, names.matchingIds(q))));
    }

    /** Recomputes the chain; export {@code head} to an independent store to detect later rewrites. */
    @GetMapping("/audit/verify")
    AuditLog.FullVerification verify(@AuthenticationPrincipal Jwt admin) throws java.io.IOException {
        require(admin, AdminPermissions.Permission.AUDIT_READ);
        return fullVerification();
    }

    private AuditLog.FullVerification fullVerification() throws java.io.IOException {
        var chain = audit.verify();
        var heads = audit.heads();
        Long mismatch = null; int checked = 0;
        for (var checkpoint : checkpoints.read()) {
            checked++;
            String actual = checkpoint.seq() >= 1 && checkpoint.seq() <= heads.size() ? heads.get((int) checkpoint.seq() - 1) : null;
            if (!checkpoint.head().equals(actual)) { mismatch = checkpoint.seq(); break; }
        }
        return new AuditLog.FullVerification(chain.valid() && mismatch == null, chain.entries(), chain.head(), chain.firstBrokenSeq(), checked, mismatch);
    }

    /** Writes a checkpoint now (e.g. right after an incident review). */
    @PostMapping("/audit/checkpoint")
    AuditLog.FullVerification checkpointNow(@AuthenticationPrincipal Jwt admin) throws java.io.IOException {
        requireAudited(admin, AdminPermissions.Permission.AUDIT_CHECKPOINT, "audit.checkpoint", "audit");
        checkpoints.checkpoint();
        return fullVerification();
    }

    /** Accountable export (auditors): recorded with its reason before the data leaves. */
    @PostMapping("/audit/export")
    ResponseEntity<AuditExport> export(@AuthenticationPrincipal Jwt admin, @Valid @RequestBody Reason body) throws java.io.IOException {
        requireAudited(admin, AdminPermissions.Permission.AUDIT_EXPORT, "audit.export", "audit");
        audit.append(actor(admin), "audit.export", "audit", body.reason());
        var export = new AuditExport(actor(admin), clock.instant(), fullVerification(), audit.all());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .header("Content-Disposition", "attachment; filename=\"convo-audit-" + export.verification().entries() + ".json\"").body(export);
    }

    /** Aggregate service health: counts only, no account, device or endpoint identifiers. */
    record Health(com.enclave.push.PushApi.Health push) {}

    @GetMapping("/health")
    ResponseEntity<Health> health(@AuthenticationPrincipal Jwt admin) {
        require(admin, AdminPermissions.Permission.HEALTH_READ);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Health(push.health()));
    }

    /** Re-queues dead-lettered message wakes (e.g. after a distributor outage); audited first. */
    record Redriven(int queued, AuditLog.Entry audit) {}

    @PostMapping("/push/redrive")
    Redriven redrive(@AuthenticationPrincipal Jwt admin, @Valid @RequestBody Reason body) {
        requireAudited(admin, AdminPermissions.Permission.PUSH_REDRIVE, "push.redrive", "push");
        AuditLog.Entry entry = audit.append(actor(admin), "push.redrive", "push", body.reason());
        return new Redriven(push.redrive(), entry);
    }

    private void require(Jwt admin, AdminPermissions.Permission permission) {
        if (!permissions.of(admin).contains(permission)) throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "your admin role does not allow this");
    }

    /** Sensitive actions: a denial is itself recorded in the audit chain. */
    private void requireAudited(Jwt admin, AdminPermissions.Permission permission, String action, String target) {
        if (permissions.of(admin).contains(permission)) return;
        audit.append(actor(admin), "denied:" + action, target, "role lacks " + permission.name());
        throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "your admin role does not allow this");
    }

    /** Step-up: the IdP sign-in behind this token ({@code auth_time}) must be recent. */
    private void requireRecentSignIn(Jwt admin) {
        Object claim = admin.getClaim("auth_time");
        long authTime = claim instanceof Number n ? n.longValue() : claim instanceof java.time.Instant i ? i.getEpochSecond() : 0;
        if (authTime == 0 || java.time.Instant.ofEpochSecond(authTime).plus(properties.stepUpMaxAge()).isBefore(clock.instant())) {
            throw new EnclaveException(ErrorCode.STEP_UP_REQUIRED, "sign in again to confirm this action");
        }
    }

    private void requireAccount(UUID accountId) {
        if (identity.account(accountId).isEmpty()) throw new EnclaveException(ErrorCode.NOT_FOUND, "unknown account");
    }

    /** Stable admin identity for the audit: IdP subject plus readable handle. */
    private static String actor(Jwt admin) {
        String name = admin.getClaimAsString("preferred_username");
        return admin.getSubject() + (name == null ? "" : " (" + name + ")");
    }
}
