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

    AdminController(IdentityAdminApi identity, AuditLog audit, AdminActions actions) {
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
        return actions.setDisabled(actor(admin), accountId, true, body.reason());
    }

    @PostMapping("/accounts/{accountId}/enable")
    AuditLog.Entry enable(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @Valid @RequestBody Reason body) {
        return actions.setDisabled(actor(admin), accountId, false, body.reason());
    }

    @PostMapping("/accounts/{accountId}/devices/{deviceId}/revoke")
    AuditLog.Entry revoke(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @PathVariable int deviceId, @Valid @RequestBody Reason body) {
        return actions.revokeDevice(actor(admin), accountId, deviceId, body.reason());
    }

    @GetMapping("/audit")
    ResponseEntity<List<AuditLog.Entry>> audit(@RequestParam(defaultValue = "9223372036854775807") long before, @RequestParam(defaultValue = "100") int limit) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(audit.page(before, limit));
    }

    /** Recomputes the chain; export {@code head} to an independent store to detect later rewrites. */
    @GetMapping("/audit/verify")
    AuditLog.Verification verify() {
        return audit.verify();
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
