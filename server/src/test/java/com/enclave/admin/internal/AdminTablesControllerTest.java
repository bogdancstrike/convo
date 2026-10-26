package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.enclave.identity.IdentityAdminApi;
import com.enclave.identity.IdentityAdminApi.AccountSummary;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

/** Admin tables over the account directory, which is read in pages of 1,000. */
class AdminTablesControllerTest {
    private final Instant now = Instant.parse("2026-10-21T12:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final AdminProperties properties = new AdminProperties("convo-admin", new AdminProperties.Roles("convo-helpdesk", "convo-org-admin", "convo-security", "convo-auditor", "platform", "compliance"),
            "", Duration.ofMinutes(15), Duration.ofMinutes(10), new AdminProperties.Activity(true, Duration.ofDays(90)),
            new AdminProperties.Idp(java.net.URI.create("http://kc/auth"), "enclave", "convo-admin-ops", "secret", Duration.ofSeconds(5)));
    private final AuditLog audit = mock(AuditLog.class);
    private final IdentityAdminApi identity = mock(IdentityAdminApi.class);
    private final KeycloakUsers idp = mock(KeycloakUsers.class);
    private final AdminTablesController controller = new AdminTablesController(new AdminGuard(new AdminPermissions(properties), audit, properties, clock),
            identity, idp, audit, mock(AuditNames.class), new AdminPermissions(properties), mock(com.enclave.push.PushApi.class), mock(ActivityStore.class));

    private final Jwt admin = Jwt.withTokenValue("t").header("alg", "RS256").subject("admin-sub").claim("preferred_username", "op")
            .claim("auth_time", now.minusSeconds(30).getEpochSecond()).claim("realm_access", Map.of("roles", List.of("convo-admin"))).build();

    private static AccountSummary account(int n) {
        return new AccountSummary(new UUID(0, n), "user-%05d".formatted(n), null, "active", 1, Instant.EPOCH, null);
    }

    @Test void anAccountSeenOnTwoPagesIsListedOnce() {
        // An account created while paging shifts the offsets: the last row of page 1 comes back on page 2.
        List<AccountSummary> first = IntStream.range(0, 1000).mapToObj(AdminTablesControllerTest::account).toList();
        List<AccountSummary> second = new ArrayList<>(List.of(account(999), account(1000), account(1001)));
        when(identity.accountDirectory(0, 1000)).thenReturn(first);
        when(identity.accountDirectory(1000, 1000)).thenReturn(second);
        when(idp.directory()).thenReturn(List.of());
        when(identity.accountsBySubject(anyList())).thenReturn(Map.of());

        var page = controller.people(admin, Map.of("size", "100")).getBody();

        assertThat(page).isNotNull();
        assertThat(page.total()).isEqualTo(1002);
    }

    @Test void aSinglePartialPageIsReadOnce() {
        when(identity.accountDirectory(0, 1000)).thenReturn(List.of(account(1), account(2)));
        when(idp.directory()).thenReturn(List.of());
        when(identity.accountsBySubject(anyList())).thenReturn(Map.of());

        assertThat(controller.people(admin, Map.of()).getBody().total()).isEqualTo(2);
        verify(identity, times(1)).accountDirectory(anyInt(), anyInt());
    }
}
