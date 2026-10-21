package com.enclave.push.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.Answers;
import org.springframework.jdbc.core.simple.JdbcClient;

class PushServiceTest {
    private final PushProperties properties = new PushProperties(true, List.of("http://convo.example:8091"), "http://ntfy:80",
            Duration.ofSeconds(30), Duration.ofSeconds(3), Duration.ofSeconds(5), 4, Duration.ofMillis(1));
    private final DeviceAddress device = new DeviceAddress(UUID.randomUUID(), 1);

    @Test void onlyAllowListedDistributorsAreAcceptedAndReachedInternally() {
        var push = new PushService(mock(JdbcClient.class), properties, Clock.systemUTC());
        assertThat(push.allowed("http://convo.example:8091/upAbC123?up=1")).isTrue();
        assertThat(push.allowed("http://evil.example:8091/upAbC123")).isFalse();
        assertThat(push.allowed("http://user:pw@convo.example:8091/up")).isFalse();
        assertThat(push.allowed("http://169.254.169.254/latest")).isFalse();
        assertThat(push.internal("http://convo.example:8091/upAbC123?up=1")).isEqualTo("http://ntfy:80/upAbC123?up=1");
        assertThatThrownBy(() -> push.register(device, "https://attacker.example/x")).isInstanceOf(EnclaveException.class);
        assertThat(PushService.WAKE).doesNotContain("from").doesNotContain("conversation");
    }

    @Test void transientFailuresAreRetriedThenDelivered() {
        var responses = new ArrayDeque<Object>(List.of(new java.net.ConnectException(), 503, 429, 200));
        List<String> urls = new ArrayList<>();
        var push = new PushService(mock(JdbcClient.class), properties, Clock.systemUTC(), (url, payload) -> {
            urls.add(url);
            Object next = responses.pop();
            if (next instanceof Exception e) throw e;
            return (Integer) next;
        });
        assertThat(push.deliver(device, "http://convo.example:8091/upX?up=1", PushService.URGENT)).isEqualTo(PushService.Outcome.DELIVERED);
        assertThat(urls).hasSize(4).allMatch(u -> u.equals("http://ntfy:80/upX?up=1"));
    }

    @Test void attemptsAreBoundedAndClientErrorsAreNotRetried() {
        int[] calls = {0};
        var push = new PushService(mock(JdbcClient.class), properties, Clock.systemUTC(), (url, payload) -> { calls[0]++; return 502; });
        assertThat(push.deliver(device, "http://convo.example:8091/upX", PushService.WAKE)).isEqualTo(PushService.Outcome.RETRY);
        assertThat(calls[0]).isEqualTo(4);
        calls[0] = 0;
        var rejecting = new PushService(mock(JdbcClient.class), properties, Clock.systemUTC(), (url, payload) -> { calls[0]++; return 400; });
        assertThat(rejecting.deliver(device, "http://convo.example:8091/upX", PushService.WAKE)).isEqualTo(PushService.Outcome.REJECTED);
        assertThat(calls[0]).isEqualTo(1);
    }

    @Test void aVanishedEndpointIsForgotten() {
        JdbcClient jdbc = mock(JdbcClient.class, Answers.RETURNS_DEEP_STUBS);
        var push = new PushService(jdbc, properties, Clock.systemUTC(), (url, payload) -> 404);
        assertThat(push.deliver(device, "http://convo.example:8091/upX", PushService.WAKE)).isEqualTo(PushService.Outcome.GONE);
        verify(jdbc).sql(startsWith("DELETE FROM push_endpoints"));
    }
}
