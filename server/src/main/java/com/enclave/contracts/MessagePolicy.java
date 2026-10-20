package com.enclave.contracts;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Public message-mutation policy advertised to every client (specs §25.1).
 *
 * <p>The server never sees message plaintext, so edit windows are enforced by receiving clients:
 * they compare the server timestamp of the edit envelope with the server timestamp of the original
 * message. The server's clock is therefore the single time authority; sender clocks are ignored.
 *
 * @param editWindow how long authors may edit text in direct chats, groups and Note to self
 * @param channelEditWindow how long channel (admin-only group) authors may edit their posts
 * @param editDeliveryGrace extra tolerance for edits queued offline inside the window and
 *     accepted by the server shortly after it closed
 */
@Validated
@ConfigurationProperties("enclave.message-policy")
public record MessagePolicy(
        @DefaultValue("15m") Duration editWindow,
        @DefaultValue("30d") Duration channelEditWindow,
        @DefaultValue("5m") Duration editDeliveryGrace) {

    public MessagePolicy {
        if (editWindow.isNegative() || editWindow.isZero() || channelEditWindow.isNegative() || channelEditWindow.isZero()) {
            throw new IllegalArgumentException("edit windows must be positive");
        }
        if (editDeliveryGrace.isNegative() || editDeliveryGrace.compareTo(Duration.ofHours(1)) > 0) {
            throw new IllegalArgumentException("edit delivery grace must be between 0 and 1h");
        }
    }
}
