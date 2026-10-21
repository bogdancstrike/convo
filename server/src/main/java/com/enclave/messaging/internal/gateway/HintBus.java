package com.enclave.messaging.internal.gateway;

import com.enclave.contracts.DeviceAddress;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Content-free cross-replica hints over Valkey pub/sub (specs §1.1 key catalogue):
 * {@code mail:{account}.{device}} → "1" and {@code ctl:{account}.{device}} → directive name, plus
 * {@code presence:{account}.{device}} keys.
 *
 * <p>Hints are best effort: every publish is also delivered to local sessions directly, failures
 * are logged and swallowed, and keepalive mailbox checks recover anything lost.
 */
@Component
class HintBus implements MessageListener {

    static final String MAIL_PREFIX = "mail:";
    static final String CONTROL_PREFIX = "ctl:";
    static final String PRESENCE_PREFIX = "presence:";

    private static final Logger log = LoggerFactory.getLogger(HintBus.class);

    private final StringRedisTemplate redis;
    private final DeviceSessionRegistry registry;

    HintBus(StringRedisTemplate redis, DeviceSessionRegistry registry) {
        this.redis = redis;
        this.registry = registry;
    }

    /** Signals that a device has new mail. */
    void signalMail(DeviceAddress device) {
        registry.onMail(device);
        publish(MAIL_PREFIX + device, "1");
    }

    /** Sends a control directive to a device's sessions on any replica. */
    void signalControl(DeviceAddress device, Directive directive) {
        registry.onControl(device, directive);
        publish(CONTROL_PREFIX + device, directive.name());
    }

    /** Whether any replica currently holds a live session for the device (presence key present). */
    boolean isPresent(DeviceAddress device) {
        try {
            return Boolean.TRUE.equals(redis.hasKey(PRESENCE_PREFIX + device));
        } catch (RuntimeException e) {
            return false; // unknown: let the wake-up channel try
        }
    }

    /** Refreshes the presence key of a device. */
    void markPresent(DeviceAddress device, String replicaId, Duration ttl) {
        try {
            redis.opsForValue().set(PRESENCE_PREFIX + device, replicaId, ttl);
        } catch (RuntimeException e) {
            log.debug("Presence update failed: {}", e.toString());
        }
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String channel = new String(message.getChannel(), java.nio.charset.StandardCharsets.UTF_8);
        String body = new String(message.getBody(), java.nio.charset.StandardCharsets.UTF_8);
        try {
            if (channel.startsWith(MAIL_PREFIX)) {
                registry.onMail(DeviceAddress.parse(channel.substring(MAIL_PREFIX.length())));
            } else if (channel.startsWith(CONTROL_PREFIX)) {
                registry.onControl(DeviceAddress.parse(channel.substring(CONTROL_PREFIX.length())), Directive.valueOf(body));
            }
        } catch (RuntimeException e) {
            log.warn("Ignoring malformed hint on {}", channel);
        }
    }

    private void publish(String channel, String body) {
        try {
            redis.convertAndSend(channel, body);
        } catch (RuntimeException e) {
            log.warn("Valkey hint publish failed ({}); relying on keepalive polling", e.getClass().getSimpleName());
        }
    }
}
