package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class SystemHealthTest {
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-24T12:00:00Z"), ZoneOffset.UTC);
    private static SystemHealthProperties properties(Duration timeout) { return new SystemHealthProperties(timeout, Duration.ofSeconds(10), "", "", "", "", 3478); }
    private static SystemHealth.Probe probe(String id, boolean required, SystemHealth.Operation operation) { return new SystemHealth.Probe(id, id, "Core", required, "Read-only test", operation); }
    @Test void isolatesFailureAndCachesCompleteSnapshotWithoutLeakingExceptionMessages() {
        AtomicInteger calls = new AtomicInteger();
        var service = new SystemHealth(properties(Duration.ofSeconds(1)), List.of(
            probe("good", true, () -> { calls.incrementAndGet(); return SystemHealth.Observation.up("Ready"); }),
            probe("bad", true, () -> { throw new IllegalStateException("password=secret-endpoint-token"); })), clock);
        try {
            var snapshot = service.snapshot();
            assertThat(snapshot.status()).isEqualTo(SystemHealth.State.DOWN);
            assertThat(snapshot.components()).hasSize(2);
            assertThat(snapshot.components().getFirst().status()).isEqualTo(SystemHealth.State.UP);
            assertThat(snapshot.toString()).doesNotContain("password", "secret-endpoint-token");
            assertThat(service.snapshot()).isSameAs(snapshot);
            assertThat(calls).hasValue(1);
        } finally { service.close(); }
    }
    @Test void slowDependencyTimesOutWithoutDiscardingFastResults() {
        var service = new SystemHealth(properties(Duration.ofMillis(80)), List.of(
            probe("slow", false, () -> { Thread.sleep(5000); return SystemHealth.Observation.up("Late"); }),
            probe("fast", true, () -> SystemHealth.Observation.up("Ready"))), clock);
        try {
            var snapshot = service.snapshot();
            assertThat(snapshot.status()).isEqualTo(SystemHealth.State.DEGRADED);
            assertThat(snapshot.components().getFirst().detail()).contains("timed out");
            assertThat(snapshot.components().getLast().status()).isEqualTo(SystemHealth.State.UP);
        } finally { service.close(); }
    }
    @Test void unknownRequiredComponentsAndDisabledRequiredIntegrationsPreventAllHealthyStatus() {
        var unknown = new SystemHealth.Check("web", "Web", "Interfaces", true, "HTTP", SystemHealth.State.UNKNOWN, "No target", 0, clock.instant());
        assertThat(SystemHealth.overall(List.of(unknown))).isEqualTo(SystemHealth.State.DEGRADED);
        var optional = new SystemHealth.Check("web-push", "Browser push", "Communications", false, "Configuration", SystemHealth.State.DISABLED, "Disabled", 0, clock.instant());
        assertThat(SystemHealth.overall(List.of(optional))).isEqualTo(SystemHealth.State.UP);
        assertThat(SystemHealth.overall(List.of())).isEqualTo(SystemHealth.State.UNKNOWN);
    }
    @Test void enforcesPermissionBeforeReadingCachedHealth() {
        var guard = mock(AdminGuard.class);
        var service = mock(SystemHealth.class);
        doThrow(new IllegalStateException("denied")).when(guard).require(null, AdminPermissions.Permission.HEALTH_READ);
        assertThatThrownBy(() -> new SystemHealthController(guard, service).system(null)).hasMessage("denied");
        verifyNoInteractions(service);
    }
    @Test void rejectsUnboundedProbeConfiguration() {
        assertThatThrownBy(() -> properties(Duration.ofMinutes(1))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new SystemHealthProperties(Duration.ofSeconds(2), Duration.ZERO, "", "", "", "", 3478)).isInstanceOf(IllegalArgumentException.class);
    }
}
