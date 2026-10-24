package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.DeviceRegistered;
import com.enclave.identity.DeviceRevoked;
import com.enclave.identity.IdentityAdminApi;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.PlatformTransactionManager;

class IdentityAuditTest {
    private KeycloakUsers.IdentityEvent event(String type, Map<String, String> details) {
        return new KeycloakUsers.IdentityEvent("event-1", 1000, type, "enclave-web", "subject", "session", null, details);
    }
    @AfterEach void clearSecurity() { SecurityContextHolder.clearContext(); }

    @Test void mapsPasskeysCredentialsAuthenticationAndFailures() {
        assertThat(IdentityAuditImporter.action(event("LOGIN", Map.of()))).isEqualTo("auth.login");
        assertThat(IdentityAuditImporter.action(event("LOGOUT", Map.of()))).isEqualTo("auth.logout");
        assertThat(IdentityAuditImporter.action(event("LOGIN_ERROR", Map.of()))).isEqualTo("auth.login.failed");
        assertThat(IdentityAuditImporter.action(event("UPDATE_CREDENTIAL", Map.of("credential_type", "webauthn-passwordless")))).isEqualTo("passkey.add");
        assertThat(IdentityAuditImporter.action(event("REMOVE_CREDENTIAL", Map.of("credential_type", "webauthn-passwordless")))).isEqualTo("passkey.remove");
        assertThat(IdentityAuditImporter.action(event("REMOVE_CREDENTIAL", Map.of("credential_type", "otp")))).isEqualTo("credential.remove");
        assertThat(IdentityAuditImporter.action(event("CLIENT_LOGIN", Map.of()))).isNull();
        assertThat(IdentityAuditImporter.action(event("REFRESH_TOKEN", Map.of()))).isNull();
    }

    @Test void importedDetailsNeverIncludeSecretsAndDuplicateEventsAreSkipped() {
        JdbcClient jdbc = mock(JdbcClient.class);
        JdbcClient.StatementSpec sql = mock(JdbcClient.StatementSpec.class, RETURNS_SELF);
        when(jdbc.sql(anyString())).thenReturn(sql);
        when(sql.update()).thenReturn(1, 0);
        AuditLog audit = mock(AuditLog.class);
        var importer = new IdentityAuditImporter(mock(KeycloakUsers.class), jdbc, audit, Clock.systemUTC(), mock(PlatformTransactionManager.class));
        var event = event("LOGIN", Map.of("username", "ana", "token", "secret-access-token", "password", "secret-password"));
        importer.ingest(event); importer.ingest(event);
        verify(audit, times(1)).appendAt(Instant.ofEpochMilli(1000), "idp:subject (ana)", "auth.login", "idp:subject", "Keycloak LOGIN · client enclave-web");
        verifyNoMoreInteractions(audit);
    }

    @Test void anUnavailableSourceRollsBackRatherThanAdvancingTheCursor() {
        JdbcClient jdbc = mock(JdbcClient.class, RETURNS_DEEP_STUBS);
        when(jdbc.sql(anyString()).query(Long.class).single()).thenReturn(5000L);
        KeycloakUsers idp = mock(KeycloakUsers.class);
        when(idp.available()).thenReturn(true);
        when(idp.events(anyLong(), anyLong(), anyInt(), anyInt())).thenThrow(new IllegalStateException("offline"));
        PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
        var tx = new org.springframework.transaction.support.SimpleTransactionStatus();
        when(manager.getTransaction(any())).thenReturn(tx);
        var importer = new IdentityAuditImporter(idp, jdbc, mock(AuditLog.class), Clock.fixed(Instant.ofEpochMilli(100000), ZoneOffset.UTC), manager);
        importer.poll();
        verify(manager).rollback(tx); verify(manager, never()).commit(any());
        assertThat(importer.status().lastSuccess()).isNull(); assertThat(importer.status().error()).contains("sync failed");
    }

    @Test void recordsActualDeviceActorAndDifferentRemovalReasons() {
        UUID account = UUID.randomUUID();
        var address = new DeviceAddress(account, 2);
        var principal = new AuthenticatedDevice(new DeviceAddress(account, 1), "web");
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken(principal, null));
        AuditLog audit = mock(AuditLog.class);
        var listener = new UserActionAudit(audit, mock(IdentityAdminApi.class));
        listener.registered(new DeviceRegistered(address, 1));
        listener.revoked(new DeviceRevoked(address, 2, "unlinked"));
        listener.revoked(new DeviceRevoked(address, 3, "self"));
        verify(audit).append(eq(account + " () device:1"), eq("device.add"), eq(account + ".2"), anyString());
        verify(audit).append(anyString(), eq("device.remove"), eq(account + ".2"), eq("unlinked"));
        verify(audit).append(anyString(), eq("device.sign-out"), eq(account + ".2"), eq("self"));
    }

    @Test void userMutationsExcludeEncryptedTrafficAndHeartbeats() {
        assertThat(UserRequestAudit.action("PUT", "/v1/recovery")).isEqualTo("recovery.save");
        assertThat(UserRequestAudit.action("POST", "/v1/devices/recover")).isEqualTo("recovery.use");
        assertThat(UserRequestAudit.action("PUT", "/v1/privacy/last-seen")).isEqualTo("privacy.last-seen-update");
        assertThat(UserRequestAudit.action("POST", "/v1/groups")).isEqualTo("group.post");
        assertThat(UserRequestAudit.action("PUT", "/v1/groups/{groupId}/messages")).isNull();
        assertThat(UserRequestAudit.action("PUT", "/v1/messages/{accountId}")).isNull();
        assertThat(UserRequestAudit.action("POST", "/v1/privacy/last-seen/heartbeat")).isNull();
        assertThat(UserRequestAudit.action("GET", "/v1/recovery")).isNull();
    }
}
