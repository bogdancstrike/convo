package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.ObjectMapper;

class ComponentProbesTest {
    @Test void disabledAndUnconfiguredServicesAreDistinguishedFromHealthyOnes() throws Exception {
        var probes = probes(new MockEnvironment(), mock(IdentityAuditImporter.class));
        for (String id : new String[]{"calls", "push", "turn", "web-push"}) assertThat(run(probes, id).status()).isEqualTo(SystemHealth.State.DISABLED);
        for (String id : new String[]{"web", "admin", "operations"}) assertThat(run(probes, id).status()).isEqualTo(SystemHealth.State.UNKNOWN);
        var enabled = probes(new MockEnvironment().withProperty("enclave.calls.enabled", "true").withProperty("enclave.push.enabled", "true"), mock(IdentityAuditImporter.class));
        assertThat(run(enabled, "calls").status()).isEqualTo(SystemHealth.State.UNKNOWN);
        assertThat(run(enabled, "push").status()).isEqualTo(SystemHealth.State.UNKNOWN);
    }
    @Test void auditFreshnessAndMissingBrowserKeysAreReportedAccurately() throws Exception {
        var importer = mock(IdentityAuditImporter.class);
        var probes = probes(new MockEnvironment().withProperty("enclave.push.web-push.enabled", "true"), importer);
        assertThat(run(probes, "web-push").status()).isEqualTo(SystemHealth.State.DOWN);
        when(importer.status()).thenReturn(new IdentityAuditImporter.Status(true, Instant.parse("2026-10-24T11:59:30Z"), null));
        assertThat(run(probes, "identity-audit").status()).isEqualTo(SystemHealth.State.UP);
        when(importer.status()).thenReturn(new IdentityAuditImporter.Status(true, Instant.parse("2026-10-24T11:50:00Z"), null));
        assertThat(run(probes, "identity-audit").status()).isEqualTo(SystemHealth.State.DEGRADED);
        when(importer.status()).thenReturn(new IdentityAuditImporter.Status(false, null, null));
        assertThat(run(probes, "identity-audit").status()).isEqualTo(SystemHealth.State.DISABLED);
    }
    private ComponentProbes probes(MockEnvironment env, IdentityAuditImporter importer) {
        return new ComponentProbes(env, mock(DataSource.class), mock(RedisConnectionFactory.class), mock(ApplicationAvailability.class),
            new SystemHealthProperties(Duration.ofSeconds(2), Duration.ofSeconds(10), "", "", "", "", 3478), importer,
            Clock.fixed(Instant.parse("2026-10-24T12:00:00Z"), ZoneOffset.UTC), new ObjectMapper());
    }
    private SystemHealth.Observation run(ComponentProbes probes, String id) throws Exception { return probes.probes().stream().filter(p -> p.id().equals(id)).findFirst().orElseThrow().operation().run(); }
}
