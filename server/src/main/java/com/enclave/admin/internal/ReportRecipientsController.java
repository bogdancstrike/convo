package com.enclave.admin.internal;

import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.IdentityAdminApi;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Who may receive abuse reports (specs AC-SEC-09): active Convo accounts whose sign-in account holds
 * the organization's security role. Reports themselves are end-to-end encrypted messages from the
 * reporter's device to the chosen recipient — the server only answers this directory question and
 * never sees evidence. Device-authenticated; cached for a minute to spare the identity provider.
 */
@RestController
class ReportRecipientsController {
    record Recipient(UUID accountId, String displayName) {}
    private record Cached(Instant at, List<Recipient> recipients) {}

    private static final Duration TTL = Duration.ofMinutes(1);
    private final KeycloakUsers idp;
    private final IdentityAdminApi identity;
    private final AdminProperties properties;
    private final Clock clock;
    private volatile Cached cache;

    ReportRecipientsController(KeycloakUsers idp, IdentityAdminApi identity, AdminProperties properties, Clock clock) {
        this.idp = idp; this.identity = identity; this.properties = properties; this.clock = clock;
    }

    @GetMapping("/v1/reports/recipients")
    ResponseEntity<List<Recipient>> recipients(@AuthenticationPrincipal AuthenticatedDevice me) {
        var all = current();
        // Reporting to yourself makes no sense; a security officer reports to colleagues.
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(all.stream().filter(r -> !r.accountId().equals(me.accountId())).toList());
    }

    private List<Recipient> current() {
        var cached = cache;
        if (cached != null && cached.at().plus(TTL).isAfter(clock.instant())) return cached.recipients();
        if (!idp.available()) return List.of();
        var holders = idp.holders(properties.roles().security()).stream().filter(KeycloakUsers.Holder::enabled).map(KeycloakUsers.Holder::id).toList();
        var accounts = identity.accountsBySubject(holders).values();
        var recipients = identity.accounts(accounts).stream().filter(a -> "active".equals(a.status()) && a.activeDevices() > 0)
                .map(a -> new Recipient(a.accountId(), a.displayName() == null || a.displayName().isBlank() ? a.username() : a.displayName())).toList();
        cache = new Cached(clock.instant(), recipients);
        return recipients;
    }
}
