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
 * Administrator API ({@code /v1/admin/**}, Keycloak token with the admin realm role, enforced in
 * the security chain). State-changing actions require a reason and are appended to the audit log
 * in the same transaction boundary as the change is requested.
 */
@RestController
@RequestMapping("/v1/admin")
class AdminController {
    record Reason(@NotBlank @Size(max = 500) String reason) {}

    private final IdentityAdminApi identity;
    private final AuditLog audit;
    private final AdminActions actions;
    private final AuditCheckpoints checkpoints;

    private final AdminProperties properties;
    private final java.time.Clock clock;

    AdminController(IdentityAdminApi identity, AuditLog audit, AdminActions actions, AuditCheckpoints checkpoints, AdminProperties properties, java.time.Clock clock) {
        this.checkpoints = checkpoints;
        this.properties = properties;
        this.clock = clock;
        this.identity = identity;
        this.audit = audit;
        this.actions = actions;
    }

    @GetMapping("/accounts")
    List<IdentityAdminApi.AccountSummary> accounts(@RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "50") int limit) {
        return identity.searchAccounts(q, limit);
    }

    @GetMapping("/accounts/{accountId}/devices")
    List<IdentityAdminApi.DeviceSummary> devices(@PathVariable UUID accountId) {
        requireAccount(accountId);
        return identity.devices(accountId);
    }

    @PostMapping("/accounts/{accountId}/disable")
    AuditLog.Entry disable(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @Valid @RequestBody Reason body) {
        requireRecentSignIn(admin);
        return actions.setDisabled(actor(admin), accountId, true, body.reason());
    }

    @PostMapping("/accounts/{accountId}/enable")
    AuditLog.Entry enable(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @Valid @RequestBody Reason body) {
        requireRecentSignIn(admin);
        return actions.setDisabled(actor(admin), accountId, false, body.reason());
    }

    @PostMapping("/accounts/{accountId}/devices/{deviceId}/revoke")
    AuditLog.Entry revoke(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @PathVariable int deviceId, @Valid @RequestBody Reason body) {
        requireRecentSignIn(admin);
        return actions.revokeDevice(actor(admin), accountId, deviceId, body.reason());
    }

    @GetMapping("/audit")
    ResponseEntity<List<AuditLog.Entry>> audit(@RequestParam(defaultValue = "9223372036854775807") long before, @RequestParam(defaultValue = "100") int limit) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(audit.page(before, limit));
    }

    /** Recomputes the chain; export {@code head} to an independent store to detect later rewrites. */
    @GetMapping("/audit/verify")
    AuditLog.FullVerification verify() throws java.io.IOException {
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
    AuditLog.FullVerification checkpointNow() throws java.io.IOException {
        checkpoints.checkpoint();
        return verify();
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
