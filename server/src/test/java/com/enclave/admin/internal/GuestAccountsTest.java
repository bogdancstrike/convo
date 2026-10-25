package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.enclave.identity.IdentityAdminApi;
import java.net.URI;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class GuestAccountsTest {
    private final Instant now = Instant.parse("2026-10-25T12:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final AdminProperties props = new AdminProperties("convo-admin", new AdminProperties.Roles("help", "org", "security", "auditor"), "", Duration.ofMinutes(15), Duration.ofMinutes(10),
            new AdminProperties.Activity(true, Duration.ofDays(90)), new AdminProperties.Idp(URI.create("http://idp/auth"), "enclave", "ops", "secret", Duration.ofSeconds(5)));
    private final KeycloakUsers idp = mock(KeycloakUsers.class);
    private final IdentityAdminApi identity = mock(IdentityAdminApi.class);
    private final AuditLog audit = mock(AuditLog.class);
    private final GuestAccounts guests = new GuestAccounts(idp, identity, new AdminGuard(new AdminPermissions(props), audit, props, clock), audit, clock);

    private Jwt token(String role) {
        return Jwt.withTokenValue("t").header("alg", "RS256").subject("operator").claim("preferred_username", "ana")
                .claim("auth_time", now.getEpochSecond()).claim("realm_access", Map.of("roles", List.of(role))).build();
    }

    @Test void createsATimeLimitedSignInAccountAndAuditsIt() {
        var user = new KeycloakUsers.IdpUser("g1", "grace", "Grace", "", null, null, true, now, List.of("UPDATE_PASSWORD"), List.of("password"), List.of(), 0, null);
        when(idp.create(any())).thenReturn(new KeycloakUsers.Created(user, "temp-secret"));
        var created = guests.create(token("org"), new GuestAccounts.NewGuest("grace", "Grace", "", null, 14, "visiting auditor"));
        assertThat(created.expiresAt()).isEqualTo(now.plus(Duration.ofDays(14)));
        assertThat(created.temporaryPassword()).isEqualTo("temp-secret");
        verify(identity).markGuest("g1", now.plus(Duration.ofDays(14)), "operator (ana)");
        verify(audit).append(eq("operator (ana)"), eq("guest.create"), eq("idp:g1 (grace)"), contains("visiting auditor"));
    }

    @Test void readOnlyRolesCannotCreateGuests() {
        assertThatThrownBy(() -> guests.create(token("auditor"), new GuestAccounts.NewGuest("x", null, null, null, 1, "r"))).isInstanceOf(RuntimeException.class);
        verifyNoInteractions(idp);
    }

    @Test void expiryDisablesSignInAndTheConvoAccountOnceAndContinuesPastFailures() {
        UUID account = UUID.randomUUID();
        when(identity.dueGuests(now)).thenReturn(List.of("broken", "g1"));
        when(idp.available()).thenReturn(true);
        doThrow(new IllegalStateException("idp down")).when(idp).setEnabled("broken", false);
        when(identity.accountsBySubject(List.of("g1"))).thenReturn(Map.of("g1", account));
        guests.expire();
        verify(idp).setEnabled("g1", false); verify(idp).signOut("g1");
        verify(identity).setDisabled(account, true);
        verify(identity).guestExpired("g1", now);
        verify(identity, never()).guestExpired(eq("broken"), any());
        verify(audit).append("system", "guest.expire", "idp:g1", "guest access ended");
    }

    @Test void extendingReEnablesAnExpiredGuest() {
        UUID account = UUID.randomUUID();
        when(identity.accountsBySubject(List.of("g1"))).thenReturn(Map.of("g1", account));
        var result = guests.extend(token("security"), "g1", new GuestAccounts.Extend(7, "project extended"));
        assertThat(result.expiresAt()).isEqualTo(now.plus(Duration.ofDays(7)));
        verify(idp).setEnabled("g1", true);
        verify(identity).setDisabled(account, false);
    }
}
