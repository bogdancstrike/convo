package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.IdentityAdminApi;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class StepUpTest {
    private final Instant now = Instant.parse("2026-10-21T12:00:00Z");
    private final AdminActions actions = mock(AdminActions.class);
    private final AdminProperties properties = new AdminProperties("convo-admin", new AdminProperties.Roles("convo-helpdesk", "convo-org-admin", "convo-security", "convo-auditor"),
            "", Duration.ofMinutes(15), Duration.ofMinutes(10),
            new AdminProperties.Activity(true, Duration.ofDays(90)),
            new AdminProperties.Idp(java.net.URI.create("http://kc/auth"), "enclave", "convo-admin-ops", "", Duration.ofSeconds(5)));
    private final AdminController controller = new AdminController(mock(IdentityAdminApi.class), mock(AuditLog.class), actions, mock(AuditCheckpoints.class),
            properties, Clock.fixed(now, ZoneOffset.UTC), new AdminPermissions(properties),
            mock(com.enclave.push.PushApi.class));

    private Jwt token(Instant authTime) {
        var builder = Jwt.withTokenValue("t").header("alg", "RS256").subject("admin-sub").claim("preferred_username", "admin")
                .claim("realm_access", java.util.Map.of("roles", java.util.List.of("convo-admin")));
        if (authTime != null) builder.claim("auth_time", authTime.getEpochSecond());
        return builder.build();
    }

    @Test void sensitiveActionsNeedARecentSignIn() {
        var id = UUID.randomUUID();
        controller.disable(token(now.minusSeconds(60)), id, new AdminController.Reason("review"));
        verify(actions).setDisabled("admin-sub (admin)", id, true, "review");
        for (Jwt stale : new Jwt[] {token(now.minus(Duration.ofMinutes(11))), token(null)}) {
            assertThatThrownBy(() -> controller.revoke(stale, id, 2, new AdminController.Reason("lost phone")))
                    .isInstanceOfSatisfying(EnclaveException.class, e -> org.assertj.core.api.Assertions.assertThat(e.code()).isEqualTo(ErrorCode.STEP_UP_REQUIRED));
        }
        verify(actions, never()).revokeDevice(anyString(), any(), anyInt(), anyString());
        verify(actions, times(1)).setDisabled(anyString(), any(), anyBoolean(), anyString());
    }
}
