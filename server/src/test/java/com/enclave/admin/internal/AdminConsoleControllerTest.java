package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.enclave.calls.CallsApi;
import com.enclave.communities.CommunitiesApi;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.groups.GroupsApi;
import com.enclave.identity.IdentityAdminApi;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class AdminConsoleControllerTest {
    private final Instant now = Instant.parse("2026-10-21T12:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final AdminProperties properties = new AdminProperties("convo-admin", new AdminProperties.Roles("convo-helpdesk", "convo-org-admin", "convo-security", "convo-auditor", "platform", "compliance"),
            "", Duration.ofMinutes(15), Duration.ofMinutes(10), new AdminProperties.Activity(true, Duration.ofDays(90)),
            new AdminProperties.Idp(java.net.URI.create("http://kc/auth"), "enclave", "convo-admin-ops", "secret", Duration.ofSeconds(5)));
    private final AuditLog audit = mock(AuditLog.class);
    private final ActivityStore activity = mock(ActivityStore.class);
    private final IdentityAdminApi identity = mock(IdentityAdminApi.class);
    private final KeycloakUsers idp = mock(KeycloakUsers.class);
    private final CallsApi calls = mock(CallsApi.class);
    private final AdminConsoleController controller = new AdminConsoleController(new AdminGuard(new AdminPermissions(properties), audit, properties, clock),
            audit, activity, identity, mock(GroupsApi.class), mock(CommunitiesApi.class), calls, idp, properties);

    private Jwt token(String subject, Instant authTime, String... roles) {
        return Jwt.withTokenValue("t").header("alg", "RS256").subject(subject).claim("preferred_username", "op")
                .claim("auth_time", authTime.getEpochSecond()).claim("realm_access", Map.of("roles", List.of(roles))).build();
    }
    private Jwt fresh(String... roles) { return token("admin-sub", now.minusSeconds(30), roles); }

    @Test void statisticsFillEveryDayAndNeedTheStatsPermission() {
        when(activity.today()).thenReturn(LocalDate.of(2026, 10, 21));
        when(activity.daily(any())).thenReturn(List.of(new ActivityStore.Day(LocalDate.of(2026, 10, 20), 42, 3, 2, 2, 1)));
        when(identity.newAccountsPerDay(any())).thenReturn(List.of());
        when(calls.callsPerDay(any())).thenReturn(List.of(new CallsApi.CallDay(LocalDate.of(2026, 10, 21), 2, 1, 0)));
        when(identity.directoryStats(any())).thenReturn(new IdentityAdminApi.DirectoryStats(10, 1, 12, 3, 5, 8));
        var overview = controller.overview(fresh("convo-auditor"), 7).getBody();
        assertThat(overview.days()).hasSize(7);
        assertThat(overview.days().get(5)).extracting(AdminConsoleController.DayStats::items, AdminConsoleController.DayStats::activeAccounts).containsExactly(42L, 3L);
        assertThat(overview.days().get(6).calls()).isEqualTo(2);
        assertThatThrownBy(() -> controller.overview(fresh("offline_access"), 30)).isInstanceOf(EnclaveException.class);
    }

    @Test void explicitHistoricalRangeBoundsBothSeriesAndPersonQueries() {
        var from = LocalDate.of(2020, 1, 1); var to = from.plusDays(2);
        when(activity.today()).thenReturn(LocalDate.of(2026, 10, 21));
        when(activity.daily(from, to)).thenReturn(List.of(new ActivityStore.Day(from, 9, 1, 1, 1, 0)));
        when(identity.newAccountsPerDay(from)).thenReturn(List.of());
        when(calls.callsPerDay(from)).thenReturn(List.of(new CallsApi.CallDay(to.plusDays(1), 100, 0, 0)));
        var result = controller.overview(fresh("convo-auditor"), 30, from, to).getBody();
        assertThat(result.days()).hasSize(3);
        assertThat(result.days().getFirst().items()).isEqualTo(9);
        assertThat(result.days().stream().mapToLong(AdminConsoleController.DayStats::calls).sum()).isZero();
        assertThat(result.retentionDays()).isNull();
        UUID id = UUID.randomUUID();
        when(identity.account(id)).thenReturn(Optional.of(new IdentityAdminApi.AccountSummary(id, "ana", "Ana", "active", 1, now, null)));
        when(activity.account(id, from, to)).thenReturn(List.of(new ActivityStore.AccountDay(to, 4, true, true, false)));
        var person = controller.accountActivity(fresh("convo-helpdesk"), id, 30, from, to).getBody();
        assertThat(person.window()).isEqualTo(3);
        assertThat(person.from()).isEqualTo(from); assertThat(person.to()).isEqualTo(to);
        assertThat(person.summary().items()).isEqualTo(4);
        verify(activity).account(id, from, to);
    }

    @Test void activityLevelsComeFromTheShareOfActiveDays() {
        UUID id = UUID.randomUUID();
        var account = new IdentityAdminApi.AccountSummary(id, "ana", "Ana", "active", 1, now, null);
        when(activity.today()).thenReturn(LocalDate.of(2026, 10, 21));
        when(identity.account(id)).thenReturn(Optional.of(account));
        when(activity.account(eq(id), any())).thenReturn(List.of(new ActivityStore.AccountDay(LocalDate.of(2026, 10, 20), 5, true, true, false)));
        assertThat(controller.accountActivity(fresh("convo-helpdesk"), id, 30).getBody().summary().level()).isEqualTo("low");
        var many = java.util.stream.IntStream.range(0, 16).mapToObj(i -> new ActivityStore.AccountDay(LocalDate.of(2026, 10, 1 + i), 1, true, false, true)).toList();
        when(activity.account(eq(id), any())).thenReturn(many);
        assertThat(controller.accountActivity(fresh("convo-helpdesk"), id, 30).getBody().summary().level()).isEqualTo("high");
        when(activity.account(eq(id), any())).thenReturn(List.of());
        assertThat(controller.accountActivity(fresh("convo-helpdesk"), id, 30).getBody().summary().level()).isEqualTo("none");
    }

    @Test void passwordResetNeedsPermissionStepUpAndAnotherAdmin() {
        assertThatThrownBy(() -> controller.resetPassword(fresh("convo-auditor"), "u1", new AdminConsoleController.Reason("locked out")))
                .isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN_ROLE));
        verify(audit).append(eq("admin-sub (op)"), eq("denied:user.password-reset"), eq("idp:u1"), contains("USERS_CREDENTIALS"));
        assertThatThrownBy(() -> controller.resetPassword(token("admin-sub", now.minus(Duration.ofMinutes(30)), "convo-helpdesk"), "u1", new AdminConsoleController.Reason("locked out")))
                .isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.STEP_UP_REQUIRED));
        assertThatThrownBy(() -> controller.resetPassword(fresh("convo-helpdesk"), "admin-sub", new AdminConsoleController.Reason("me")))
                .isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN));
        verify(idp, never()).resetPassword(anyString());
        when(idp.resetPassword("u1")).thenReturn("TempPass123");
        assertThat(controller.resetPassword(fresh("convo-helpdesk"), "u1", new AdminConsoleController.Reason("locked out")).temporaryPassword()).isEqualTo("TempPass123");
        // The audit records the reason, never the password.
        verify(audit).append("admin-sub (op)", "user.password-reset", "idp:u1", "locked out");
    }

    @Test void onlyTheSuperuserManagesRolesAndRecoveryRevocationIsAudited() {
        assertThatThrownBy(() -> controller.setRole(fresh("convo-security"), "u1", new AdminConsoleController.RoleChange("convo-admin", true, "promote")))
                .isInstanceOf(EnclaveException.class);
        verify(idp, never()).setRole(anyString(), anyString(), anyBoolean());
        UUID id = UUID.randomUUID();
        when(identity.account(id)).thenReturn(Optional.of(new IdentityAdminApi.AccountSummary(id, "ana", null, "active", 1, now, null)));
        when(identity.revokeRecovery(id)).thenReturn(true);
        assertThat(controller.revokeRecovery(fresh("convo-security"), id, new AdminConsoleController.Reason("kit leaked")).revoked()).isTrue();
        verify(audit).append("admin-sub (op)", "recovery.revoke", id.toString(), "kit leaked");
        assertThatThrownBy(() -> controller.revokeRecovery(fresh("convo-org-admin"), id, new AdminConsoleController.Reason("x"))).isInstanceOf(EnclaveException.class);
    }
}
