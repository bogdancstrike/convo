package com.enclave.push.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;

class PushServiceTest {
    private final PushService push = new PushService(mock(JdbcClient.class),
            new PushProperties(true, List.of("http://convo.example:8091"), "http://ntfy:80", Duration.ofSeconds(30), Duration.ofSeconds(3), Duration.ofSeconds(5)), Clock.systemUTC());

    @Test void onlyAllowListedDistributorsAreAcceptedAndReachedInternally() {
        assertThat(push.allowed("http://convo.example:8091/upAbC123?up=1")).isTrue();
        assertThat(push.allowed("http://evil.example:8091/upAbC123")).isFalse();
        assertThat(push.allowed("http://user:pw@convo.example:8091/up")).isFalse();
        assertThat(push.allowed("http://169.254.169.254/latest")).isFalse();
        assertThat(push.internal("http://convo.example:8091/upAbC123?up=1")).isEqualTo("http://ntfy:80/upAbC123?up=1");
        assertThatThrownBy(() -> push.register(new DeviceAddress(UUID.randomUUID(), 1), "https://attacker.example/x")).isInstanceOf(EnclaveException.class);
        assertThat(PushService.WAKE).doesNotContain("from").doesNotContain("conversation");
    }
}
