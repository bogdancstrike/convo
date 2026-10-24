package com.enclave.admin.internal;

import static com.enclave.admin.internal.AdminPermissions.Permission.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.IdentityAdminApi;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

/** AC-ADM-01: each scoped role gets exactly its duties; denied sensitive attempts are audited. */
class AdminPermissionsTest {
    private final AdminProperties properties = new AdminProperties("convo-admin", new AdminProperties.Roles("convo-helpdesk", "convo-org-admin", "convo-security", "convo-auditor"),
            "", Duration.ofMinutes(15), Duration.ofMinutes(10),
            new AdminProperties.Activity(true, Duration.ofDays(90)),
            new AdminProperties.Idp(java.net.URI.create("http://kc/auth"), "enclave", "convo-admin-ops", "", Duration.ofSeconds(5)));
    private final AdminPermissions permissions = new AdminPermissions(properties);
    private final IdentityAdminApi identity = mock(IdentityAdminApi.class);
    private final AuditLog audit = mock(AuditLog.class);
    private final AdminActions actions = mock(AdminActions.class);
    private final AdminController controller = new AdminController(identity, audit, mock(AuditNames.class), actions, mock(AuditCheckpoints.class), properties, Clock.systemUTC(), permissions, mock(com.enclave.push.PushApi.class));

    private static Jwt token(String... roles) {
        return Jwt.withTokenValue("t").header("alg", "RS256").subject("sub").claim("preferred_username", "op")
                .claim("auth_time", Instant.now().getEpochSecond()).claim("realm_access", Map.of("roles", List.of(roles))).build();
    }

    @Test void rolesMapToLeastPrivilege() {
        assertThat(permissions.of(token("convo-helpdesk"))).containsExactlyInAnyOrder(ACCOUNTS_READ, DEVICES_READ, DEVICE_REVOKE, HEALTH_READ, STATS_READ, USERS_CREDENTIALS, RECOVERY_RESET, SESSIONS_READ, SESSIONS_REVOKE);
        assertThat(permissions.of(token("convo-org-admin"))).containsExactlyInAnyOrder(ACCOUNTS_READ, ACCOUNT_STATUS, HEALTH_READ, STATS_READ, USERS_CREATE, USERS_CREDENTIALS, SESSIONS_READ, SESSIONS_REVOKE);
        assertThat(permissions.of(token("convo-auditor"))).containsExactlyInAnyOrder(AUDIT_READ, AUDIT_EXPORT, AUDIT_CHECKPOINT, STATS_READ, ALERTS_READ);
        assertThat(permissions.of(token("convo-security"))).doesNotContain(AUDIT_EXPORT).contains(PUSH_REDRIVE, ALERTS_READ, ALERTS_MANAGE, ALERT_RULES_MANAGE, SESSIONS_READ, SESSIONS_REVOKE);
        assertThat(permissions.of(token("convo-auditor"))).doesNotContain(PUSH_REDRIVE, HEALTH_READ, USERS_CREDENTIALS, RECOVERY_RESET, ALERTS_MANAGE, ALERT_RULES_MANAGE, SESSIONS_READ, SESSIONS_REVOKE);
        // Only the superuser role may grant admin roles.
        for (String role : new String[] {"convo-helpdesk", "convo-org-admin", "convo-security", "convo-auditor"}) assertThat(permissions.of(token(role))).doesNotContain(ROLES_MANAGE);
        assertThat(permissions.of(token("convo-admin"))).hasSize(AdminPermissions.Permission.values().length);
        assertThat(permissions.of(token("offline_access", "uma_authorization"))).isEmpty();
        assertThat(permissions.roles(token("convo-helpdesk", "offline_access"))).containsExactly("convo-helpdesk");
    }

    @Test void deniedSensitiveActionsAreRefusedAndAudited() {
        UUID account = UUID.randomUUID();
        assertThatThrownBy(() -> controller.disable(token("convo-helpdesk"), account, new AdminController.Reason("try")))
                .isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN_ROLE));
        verify(audit).append(eq("sub (op)"), eq("denied:account.disable"), eq(account.toString()), contains("ACCOUNT_STATUS"));
        verify(actions, never()).setDisabled(anyString(), any(), anyBoolean(), anyString());

        assertThatThrownBy(() -> controller.accounts(token("convo-auditor"), "", 10)).isInstanceOf(EnclaveException.class);
        verify(identity, never()).searchAccounts(anyString(), anyInt());

        when(identity.account(account)).thenReturn(Optional.empty());
        controller.accounts(token("convo-org-admin"), "", 10);
        controller.revoke(token("convo-helpdesk"), account, 2, new AdminController.Reason("lost phone"));
        verify(actions).revokeDevice("sub (op)", account, 2, "lost phone");

        assertThatThrownBy(() -> controller.redrive(token("convo-helpdesk"), new AdminController.Reason("ntfy back")))
                .isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN_ROLE));
        verify(audit).append(eq("sub (op)"), eq("denied:push.redrive"), eq("push"), contains("PUSH_REDRIVE"));
    }
}
