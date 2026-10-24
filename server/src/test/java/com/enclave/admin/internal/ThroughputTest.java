package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class ThroughputTest {
    @Test void fillsMinuteGapsAndSeparatesOperationsWithoutInventingHistoricalCounts() {
        Instant now = Instant.parse("2026-10-24T12:23:45Z"), minute = Instant.parse("2026-10-24T12:23:00Z");
        ThroughputStore store = mock(ThroughputStore.class);
        when(store.since(any())).thenReturn(List.of(new ThroughputStore.Minute(minute, 4, 2, 1)));
        when(store.startedAt()).thenReturn(now.minusSeconds(100));
        AdminProperties properties = mock(AdminProperties.class);
        when(properties.activity()).thenReturn(new AdminProperties.Activity(true, java.time.Duration.ofDays(90)));
        var controller = new ThroughputController(mock(AdminGuard.class), store, Clock.fixed(now, ZoneOffset.UTC), properties);
        var result = controller.throughput(null, 60).getBody();
        assertThat(result.minutes()).hasSize(60);
        assertThat(result.minutes().getFirst().minute()).isEqualTo(minute.minusSeconds(59 * 60));
        assertThat(result.minutes().getFirst().items()).isZero();
        assertThat(result.minutes().getLast()).isEqualTo(new ThroughputStore.Minute(minute, 4, 2, 1));
        assertThat(result.recordingSince()).isEqualTo(now.minusSeconds(100));
        assertThat(controller.throughput(null, 1).getBody().minutes()).hasSize(15);
        assertThat(controller.throughput(null, 10000).getBody().minutes()).hasSize(1440);
    }
    @Test void disabledActivityDoesNotCollectOperationCounters() {
        var jdbc = mock(org.springframework.jdbc.core.simple.JdbcClient.class);
        AdminProperties properties = mock(AdminProperties.class);
        when(properties.activity()).thenReturn(new AdminProperties.Activity(false, java.time.Duration.ofDays(90)));
        ThroughputStore store = new ThroughputStore(jdbc, Clock.systemUTC(), properties);
        store.sent(new com.enclave.messaging.SenderActivity(java.util.UUID.randomUUID()));
        store.handled(new com.enclave.contracts.HandledOperation(com.enclave.contracts.HandledOperation.Kind.CALL_STARTED));
        verifyNoInteractions(jdbc);
    }
}
