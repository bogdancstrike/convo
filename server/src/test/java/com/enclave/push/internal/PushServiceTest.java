package com.enclave.push.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.messaging.MailWaiting;
import com.enclave.push.internal.PushIntentStore.Claimed;
import com.enclave.push.internal.PushIntentStore.Target;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.Answers;
import org.springframework.jdbc.core.simple.JdbcClient;

class PushServiceTest {
    private static final String ENDPOINT = "http://convo.example:8091/upX?up=1";
    private final PushProperties properties = new PushProperties(true, List.of("http://convo.example:8091"), "http://ntfy:80",
            Duration.ofSeconds(30), Duration.ofSeconds(3), Duration.ofSeconds(5), 4, Duration.ofSeconds(2),
            Duration.ofHours(1), Duration.ofSeconds(60), Duration.ofSeconds(1), Duration.ofSeconds(30), 50, Duration.ofHours(24));
    private final DeviceAddress device = new DeviceAddress(UUID.randomUUID(), 1);
    private final Instant now = Instant.parse("2026-10-21T12:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);

    @Test void onlyAllowListedDistributorsAreAcceptedAndReachedInternally() {
        var push = new PushService(mock(JdbcClient.class), properties, clock);
        assertThat(push.allowed(ENDPOINT)).isTrue();
        assertThat(push.allowed("http://evil.example:8091/upAbC123")).isFalse();
        assertThat(push.allowed("http://user:pw@convo.example:8091/up")).isFalse();
        assertThat(push.allowed("http://169.254.169.254/latest")).isFalse();
        assertThat(push.internal(ENDPOINT)).isEqualTo("http://ntfy:80/upX?up=1");
        assertThatThrownBy(() -> push.register(device, "https://attacker.example/x")).isInstanceOf(EnclaveException.class);
        assertThat(PushService.WAKE).doesNotContain("from").doesNotContain("conversation");
    }

    @Test void attemptsClassifyDistributorAnswers() {
        List<String> urls = new ArrayList<>();
        for (var c : List.of(new Object[] {200, PushService.Outcome.DELIVERED}, new Object[] {503, PushService.Outcome.RETRY},
                new Object[] {429, PushService.Outcome.RETRY}, new Object[] {410, PushService.Outcome.GONE}, new Object[] {400, PushService.Outcome.REJECTED})) {
            var push = new PushService(mock(JdbcClient.class), properties, clock, (url, payload) -> { urls.add(url); return (Integer) c[0]; });
            assertThat(push.attempt(ENDPOINT, PushService.WAKE)).isEqualTo(c[1]);
        }
        var down = new PushService(mock(JdbcClient.class), properties, clock, (url, payload) -> { throw new java.net.ConnectException(); });
        assertThat(down.attempt(ENDPOINT, PushService.WAKE)).isEqualTo(PushService.Outcome.RETRY);
        assertThat(urls).allMatch(u -> u.equals("http://ntfy:80/upX?up=1"));
    }

    @Test void mailForAnOfflineDeviceRecordsOneCoalescedIntent() {
        JdbcClient jdbc = mock(JdbcClient.class, Answers.RETURNS_DEEP_STUBS);
        new PushService(jdbc, properties, clock).on(new MailWaiting(device, false));
        verify(jdbc).sql(contains("ON CONFLICT (account_id, device_id, urgent) DO NOTHING"));
        JdbcClient disabled = mock(JdbcClient.class);
        new PushService(disabled, new PushProperties(false, List.of(), "", Duration.ofSeconds(30), Duration.ofSeconds(3), Duration.ofSeconds(5), 4,
                Duration.ofSeconds(2), Duration.ofHours(1), Duration.ofSeconds(60), Duration.ofSeconds(1), Duration.ofSeconds(30), 50, Duration.ofHours(24)), clock)
                .on(new MailWaiting(device, false));
        verifyNoInteractions(disabled);
    }

    // --- dispatcher -------------------------------------------------------------------------

    private final PushIntentStore store = mock(PushIntentStore.class);

    private PushDispatcher dispatcher(int status) {
        return new PushDispatcher(store, new PushService(mock(JdbcClient.class), properties, clock, (url, payload) -> status), properties, clock);
    }

    private Claimed claimed(int attempts, boolean urgent) {
        return new Claimed(7, device.accountId(), device.deviceId(), urgent, attempts, now.plusSeconds(60));
    }

    @Test void aDeliveredWakeIsRemovedAndStampsTheRateLimit() {
        when(store.target(any())).thenReturn(Optional.of(new Target(ENDPOINT, null, null)));
        var c = claimed(1, false);
        dispatcher(200).handle(c);
        verify(store).delivered(c, now);
    }

    @Test void transientFailuresBackOffThenDeadLetter() {
        when(store.target(any())).thenReturn(Optional.of(new Target(ENDPOINT, null, null)));
        var first = claimed(1, false);
        dispatcher(503).handle(first);
        verify(store).retryAt(first, now.plusSeconds(2));
        var third = claimed(3, false);
        dispatcher(503).handle(third);
        verify(store).retryAt(third, now.plusSeconds(8));
        var last = claimed(4, false);
        dispatcher(503).handle(last);
        verify(store).dead(last, "gave_up", now);
    }

    @Test void rejectedGoneAndExpiredIntents() {
        when(store.target(any())).thenReturn(Optional.of(new Target(ENDPOINT, null, null)));
        var rejected = claimed(1, false);
        dispatcher(400).handle(rejected);
        verify(store).dead(rejected, "rejected", now);
        var gone = claimed(1, false);
        dispatcher(410).handle(gone);
        verify(store).forgetEndpoint(gone, ENDPOINT);
        var expired = new Claimed(8, device.accountId(), device.deviceId(), true, 1, now.minusSeconds(1));
        dispatcher(200).handle(expired);
        verify(store).dead(expired, "expired", now);
        verify(store, never()).target(expired);
    }

    @Test void aRecentWakeCoalescesAndAMissingEndpointDropsTheIntent() {
        var c = claimed(1, false);
        when(store.target(c)).thenReturn(Optional.of(new Target(ENDPOINT, now.minusSeconds(10), null)));
        dispatcher(200).handle(c);
        verify(store).remove(c);
        verify(store, never()).delivered(any(), any());
        var urgent = claimed(1, true); // the urgent limit is separate (3 s), so a call still rings
        when(store.target(urgent)).thenReturn(Optional.of(new Target(ENDPOINT, now.minusSeconds(10), null)));
        dispatcher(200).handle(urgent);
        verify(store).delivered(urgent, now);
        var orphan = new Claimed(9, device.accountId(), 2, false, 1, now.plusSeconds(60));
        when(store.target(orphan)).thenReturn(Optional.empty());
        dispatcher(200).handle(orphan);
        verify(store).remove(orphan);
    }
}
