package com.enclave.admin.internal;

import com.enclave.admin.internal.AdminPermissions.Permission;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.IdentityAdminApi;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

/**
 * Guest accounts (FR-EXT-01 guest invitations, FR-ADM-01): an administrator creates a time-limited
 * sign-in account (temporary password shown once, as for members) or turns an existing one into a
 * guest, and can extend it. Clients label guests from {@code guestUntil} on directory entries.
 *
 * <p>When the expiry passes, {@link #expire()} disables the IdP user, ends its sessions and disables
 * the Convo account (devices fail authentication and the person leaves the directory and fan-out).
 * Group membership is end-to-end managed by members' clients, so the server cannot remove a guest
 * from groups; disabled accounts receive nothing more. Content already downloaded cannot be erased.
 */
@RestController
@RequestMapping("/v1/admin/guests")
class GuestAccounts {
    /** Longest guest access one action grants. */
    static final int MAX_DAYS = 365;

    record NewGuest(@NotBlank @Size(max = 64) @Pattern(regexp = "[A-Za-z0-9._-]+") String username, @Size(max = 100) String firstName,
            @Size(max = 100) String lastName, @Size(max = 200) String email, @Min(1) @Max(MAX_DAYS) int days,
            @NotBlank @Size(max = 500) String reason) {}
    record Extend(@Min(1) @Max(MAX_DAYS) int days, @NotBlank @Size(max = 500) String reason) {}
    record CreatedGuest(AdminConsoleController.SignInAccount account, String temporaryPassword, Instant expiresAt, AuditLog.Entry audit) {}
    record Expiry(Instant expiresAt, AuditLog.Entry audit) {}

    private final KeycloakUsers idp;
    private final IdentityAdminApi identity;
    private final AdminGuard guard;
    private final AuditLog audit;
    private final Clock clock;

    GuestAccounts(KeycloakUsers idp, IdentityAdminApi identity, AdminGuard guard, AuditLog audit, Clock clock) {
        this.idp = idp; this.identity = identity; this.guard = guard; this.audit = audit; this.clock = clock;
    }

    @PostMapping
    CreatedGuest create(@AuthenticationPrincipal Jwt admin, @Valid @RequestBody NewGuest body) {
        guard.requireAudited(admin, Permission.USERS_CREATE, "guest.create", body.username());
        var created = idp.create(new KeycloakUsers.Draft(body.username().strip(), body.firstName(), body.lastName(), body.email(), null, false));
        Instant until = clock.instant().plus(Duration.ofDays(body.days()));
        identity.markGuest(created.user().id(), until, guard.actor(admin));
        var entry = audit.append(guard.actor(admin), "guest.create", "idp:" + created.user().id() + " (" + created.user().username() + ")",
                body.reason() + " [guest until " + until + "]");
        return new CreatedGuest(new AdminConsoleController.SignInAccount(created.user(), null), created.temporaryPassword(), until, entry);
    }

    /** Guest status of a sign-in account (404 for members). */
    @GetMapping("/{id}")
    IdentityAdminApi.GuestStatus status(@AuthenticationPrincipal Jwt admin, @PathVariable String id) {
        guard.require(admin, Permission.ACCOUNTS_READ);
        return identity.guest(id).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "not a guest"));
    }

    /** Makes an existing sign-in account a guest, or extends a guest from now (re-enabling an expired one). */
    @PostMapping("/{id}/extend")
    Expiry extend(@AuthenticationPrincipal Jwt admin, @PathVariable String id, @Valid @RequestBody Extend body) {
        guard.requireAudited(admin, Permission.ACCOUNT_STATUS, "guest.extend", "idp:" + id);
        guard.requireRecentSignIn(admin);
        if (id.equals(admin.getSubject())) throw new EnclaveException(ErrorCode.FORBIDDEN, "operators cannot change their own access");
        Instant until = clock.instant().plus(Duration.ofDays(body.days()));
        identity.markGuest(id, until, guard.actor(admin));
        idp.setEnabled(id, true);
        identity.accountsBySubject(java.util.List.of(id)).values().forEach(account -> identity.setDisabled(account, false));
        return new Expiry(until, audit.append(guard.actor(admin), "guest.extend", "idp:" + id, body.reason() + " [guest until " + until + "]"));
    }

    /** Applies due expiries; one failing guest does not block the others (retried next run). */
    @Scheduled(fixedDelayString = "${enclave.admin.guest-expiry-interval:PT1M}", initialDelayString = "PT30S")
    void expire() {
        Instant now = clock.instant();
        for (String subject : identity.dueGuests(now)) {
            try {
                if (idp.available()) { idp.setEnabled(subject, false); idp.signOut(subject); }
                identity.accountsBySubject(java.util.List.of(subject)).values().forEach(account -> identity.setDisabled(account, true));
                identity.guestExpired(subject, now);
                audit.append("system", "guest.expire", "idp:" + subject, "guest access ended");
            } catch (RuntimeException failure) {
                LoggerFactory.getLogger(GuestAccounts.class).warn("guest expiry failed: {}", failure.getClass().getSimpleName());
            }
        }
    }
}
