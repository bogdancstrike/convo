package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

import com.enclave.identity.IdentityAdminApi;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AuditNamesTest {
    @Test void resolvesBothAccountNamespacesWithoutChangingSignedFields() {
        UUID account = UUID.randomUUID(); String subject = UUID.randomUUID().toString();
        IdentityAdminApi identity = mock(IdentityAdminApi.class);
        KeycloakUsers idp = mock(KeycloakUsers.class);
        when(identity.accountsBySubject(any())).thenReturn(Map.of(subject, account));
        when(identity.accounts(any())).thenReturn(List.of(new IdentityAdminApi.AccountSummary(account, "ana", "Ana", "active", 1, Instant.EPOCH, null)));
        var entry = new AuditLog.Entry(1, Instant.EPOCH, "idp:" + subject, "device.remove", account + ".2", "unlinked", "signed-hash");
        var view = new AuditNames(identity, idp, Clock.systemUTC(), mock(org.springframework.jdbc.core.simple.JdbcClient.class)).resolve(List.of(entry)).getFirst();
        assertThat(view.actorName()).isEqualTo("ana"); assertThat(view.targetName()).isEqualTo("ana · device 2");
        assertThat(view.actor()).isEqualTo(entry.actor()); assertThat(view.target()).isEqualTo(entry.target()); assertThat(view.hash()).isEqualTo("signed-hash");
        verify(idp, never()).username(anyString());
    }
    @Test void historicalSnapshotsAndUnavailableAccountsHaveReadableLabels() {
        String id = UUID.randomUUID().toString();
        assertThat(AuditNames.label("idp:" + id + " (former-user)", Map.of())).isEqualTo("former-user");
        assertThat(AuditNames.label("idp:" + id, Map.of())).isEqualTo("Unavailable account");
        assertThat(AuditNames.label("console", Map.of())).isEqualTo("Admin console");
        assertThat(AuditNames.label(id + " (ana) device:3", Map.of(id, "ana"))).isEqualTo("ana · device 3");
    }
}
