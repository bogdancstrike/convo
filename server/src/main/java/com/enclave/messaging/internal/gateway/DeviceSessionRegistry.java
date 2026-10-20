package com.enclave.messaging.internal.gateway;

import com.enclave.contracts.DeviceAddress;
import com.enclave.messaging.internal.MessagingProperties;
import com.enclave.messaging.internal.gateway.WireFormat.ServerFrame;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;

/**
 * Sessions connected to <em>this</em> replica, keyed by device. Cross-replica routing happens via
 * Valkey hints ({@link HintBus}); each replica only acts on its own sessions.
 */
@Component
class DeviceSessionRegistry {

    /** WebSocket close code for revoked credentials (specs §4.7). */
    static final CloseStatus DEVICE_REVOKED = new CloseStatus(4401, "DEVICE_REVOKED");
    /** Close code asking clients to reconnect elsewhere (graceful shutdown). */
    static final CloseStatus RECONNECT = new CloseStatus(4100, "RECONNECT");

    private final Map<DeviceAddress, Set<DeviceSession>> sessions = new ConcurrentHashMap<>();
    private final MessagingProperties properties;

    DeviceSessionRegistry(MessagingProperties properties) {
        this.properties = properties;
    }

    void register(DeviceSession session) {
        sessions.computeIfAbsent(session.device(), k -> ConcurrentHashMap.newKeySet()).add(session);
    }

    void unregister(DeviceSession session) {
        sessions.computeIfPresent(session.device(), (k, set) -> {
            set.remove(session);
            return set.isEmpty() ? null : set;
        });
    }

    /** New mail for a device: drain each local session that is idle. */
    void onMail(DeviceAddress device) {
        sessions.getOrDefault(device, Set.of()).forEach(DeviceSession::drainIfIdle);
    }

    /** Control hint for a device. */
    void onControl(DeviceAddress device, Directive directive) {
        for (DeviceSession s : sessions.getOrDefault(device, Set.of())) {
            if (directive == Directive.REVOKED) {
                s.send(ServerFrame.directive(Directive.REVOKED));
                s.close(DEVICE_REVOKED);
            } else {
                s.send(ServerFrame.directive(directive));
            }
        }
    }

    /** @return number of locally connected sessions */
    int size() {
        return sessions.values().stream().mapToInt(Set::size).sum();
    }

    /** Closes sessions without client traffic for longer than the idle timeout (specs §9.3). */
    @Scheduled(fixedDelayString = "${enclave.messaging.websocket.idle-sweep-interval:PT15S}")
    void closeIdle() {
        Instant cutoff = Instant.now().minus(properties.websocket().idleTimeout());
        sessions.values().forEach(set -> set.stream()
                .filter(s -> s.lastActivity().isBefore(cutoff))
                .forEach(s -> s.close(CloseStatus.SESSION_NOT_RELIABLE)));
    }

    /** Asks every client to reconnect (used on graceful shutdown). */
    void closeAll() {
        sessions.values().forEach(set -> set.forEach(s -> s.close(RECONNECT)));
    }
}
