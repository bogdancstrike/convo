package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.IdentityAdminApi;
import java.net.URI;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

/** AC-SEC-09: only active security-role accounts with a device can receive reports; never yourself. */
class ReportRecipientsTest {
    private final Instant now = Instant.parse("2026-10-25T12:00:00Z");
    private final AdminProperties props = new AdminProperties("convo-admin", new AdminProperties.Roles("help", "org", "security", "auditor", "platform", "compliance"), "", Duration.ofMinutes(15), Duration.ofMinutes(10),
            new AdminProperties.Activity(true, Duration.ofDays(90)), new AdminProperties.Idp(URI.create("http://idp/auth"), "enclave", "ops", "secret", Duration.ofSeconds(5)));
    private final KeycloakUsers idp = mock(KeycloakUsers.class);
    private final IdentityAdminApi identity = mock(IdentityAdminApi.class);
    private final ReportRecipientsController controller = new ReportRecipientsController(idp, identity, props, Clock.fixed(now, ZoneOffset.UTC));
    private final UUID ana = UUID.randomUUID(), bob = UUID.randomUUID(), off = UUID.randomUUID(), me = UUID.randomUUID();

    private IdentityAdminApi.AccountSummary account(UUID id, String status, int devices) {
        var a = mock(IdentityAdminApi.AccountSummary.class);
        when(a.accountId()).thenReturn(id); when(a.status()).thenReturn(status); when(a.activeDevices()).thenReturn(devices);
        when(a.displayName()).thenReturn(""); when(a.username()).thenReturn(id.toString().substring(0, 4));
        return a;
    }

    @Test void listsActiveSecurityAccountsWithDevicesExceptTheCaller() {
        when(idp.available()).thenReturn(true);
        when(idp.holders("security")).thenReturn(List.of(new KeycloakUsers.Holder("s1", "ana", null, null, true, null), new KeycloakUsers.Holder("s2", "bob", null, null, true, null),
                new KeycloakUsers.Holder("s3", "blocked", null, null, false, null), new KeycloakUsers.Holder("s4", "me", null, null, true, null)));
        when(identity.accountsBySubject(List.of("s1", "s2", "s4"))).thenReturn(Map.of("s1", ana, "s2", bob, "s4", me));
        var accounts = List.of(account(ana, "active", 1), account(bob, "disabled", 1), account(off, "active", 0), account(me, "active", 2));
        when(identity.accounts(any())).thenReturn(accounts);
        var body = controller.recipients(new AuthenticatedDevice(new DeviceAddress(me, 1), "web")).getBody();
        assertThat(body).extracting(ReportRecipientsController.Recipient::accountId).containsExactly(ana);
        controller.recipients(new AuthenticatedDevice(new DeviceAddress(me, 1), "web"));
        verify(idp, times(1)).holders("security"); // cached for a minute
    }

    @Test void noIdentityProviderMeansNoRecipients() {
        when(idp.available()).thenReturn(false);
        assertThat(controller.recipients(new AuthenticatedDevice(new DeviceAddress(me, 1), "web")).getBody()).isEmpty();
    }
}
