package com.enclave.contracts;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

class MessagePolicyTest {
    @Test void defaultsMatchTheProductEditPolicy() {
        var policy = Binder.get(new org.springframework.mock.env.MockEnvironment()).bindOrCreate("enclave.message-policy", MessagePolicy.class);
        assertThat(policy.editWindow()).isEqualTo(Duration.ofMinutes(15));
        assertThat(policy.channelEditWindow()).isEqualTo(Duration.ofDays(30));
        assertThat(policy.editDeliveryGrace()).isEqualTo(Duration.ofMinutes(5));
    }

    @Test void bindsOverridesAndRejectsUnsafeValues() {
        var source = new MapConfigurationPropertySource(Map.of("enclave.message-policy.edit-window", "2m"));
        assertThat(new Binder(source).bindOrCreate("enclave.message-policy", MessagePolicy.class).editWindow()).isEqualTo(Duration.ofMinutes(2));
        assertThatThrownBy(() -> new MessagePolicy(Duration.ZERO, Duration.ofDays(1), Duration.ZERO)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new MessagePolicy(Duration.ofMinutes(1), Duration.ofDays(1), Duration.ofHours(2))).isInstanceOf(IllegalArgumentException.class);
    }
}
