package com.enclave.push.internal;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.DeviceRevoked;
import com.enclave.messaging.MailWaiting;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Service;

/**
 * Registers UnifiedPush endpoints and sends content-free wake-ups. Sending is asynchronous on
 * virtual threads with a per-device rate limit; failures are only logged (the mailbox keeps the
 * messages and the device catches up when it connects).
 */
@Service
class PushService {
    private static final Logger log = LoggerFactory.getLogger(PushService.class);
    /** The whole wake payload: nothing about the sender, conversation or content. */
    static final String WAKE = "{\"t\":\"wake\"}";
    /** Urgent wake (the sender marked it, e.g. a call ring): the device rings generically. */
    static final String URGENT = "{\"t\":\"urgent\"}";

    private final JdbcClient jdbc;
    private final PushProperties properties;
    private final Clock clock;
    private final HttpClient http;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Map<DeviceAddress, Instant> lastWake = new ConcurrentHashMap<>();
    private final Map<DeviceAddress, Instant> lastUrgent = new ConcurrentHashMap<>();

    PushService(JdbcClient jdbc, PushProperties properties, Clock clock) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.clock = clock;
        this.http = HttpClient.newBuilder().connectTimeout(properties.timeout()).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    void register(DeviceAddress device, String endpoint) {
        if (!allowed(endpoint)) throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "push distributor not allowed");
        jdbc.sql("""
                INSERT INTO push_endpoints (account_id, device_id, endpoint) VALUES (:a, :d, :e)
                ON CONFLICT (account_id, device_id) DO UPDATE SET endpoint = EXCLUDED.endpoint, updated_at = now()""")
                .param("a", device.accountId()).param("d", device.deviceId()).param("e", endpoint).update();
    }

    void unregister(DeviceAddress device) {
        jdbc.sql("DELETE FROM push_endpoints WHERE account_id = :a AND device_id = :d").param("a", device.accountId()).param("d", device.deviceId()).update();
    }

    /** Published after commit, outside a transaction: handle immediately, send asynchronously. */
    @EventListener
    void on(MailWaiting event) {
        if (!properties.enabled()) return;
        Instant now = clock.instant();
        var last = event.urgent() ? lastUrgent : lastWake;
        Instant previous = last.get(event.device());
        if (previous != null && previous.plus(event.urgent() ? properties.urgentMinInterval() : properties.minInterval()).isAfter(now)) return;
        String endpoint = jdbc.sql("SELECT endpoint FROM push_endpoints WHERE account_id = :a AND device_id = :d")
                .param("a", event.device().accountId()).param("d", event.device().deviceId()).query(String.class).optional().orElse(null);
        if (endpoint == null || !allowed(endpoint)) return;
        last.put(event.device(), now);
        String payload = event.urgent() ? URGENT : WAKE;
        executor.submit(() -> send(endpoint, payload));
    }

    @ApplicationModuleListener
    void on(DeviceRevoked event) {
        unregister(event.address());
        lastWake.remove(event.address());
        lastUrgent.remove(event.address());
    }

    private void send(String endpoint, String payload) {
        try {
            var request = HttpRequest.newBuilder(URI.create(internal(endpoint))).timeout(properties.timeout())
                    .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(payload)).build();
            int status = http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            if (status >= 300) log.info("Push wake rejected by distributor (HTTP {})", status);
        } catch (Exception e) {
            log.info("Push wake failed ({})", e.getClass().getSimpleName());
        }
    }

    boolean allowed(String endpoint) {
        try {
            URI uri = URI.create(endpoint);
            if (uri.getUserInfo() != null || uri.getHost() == null) return false;
            String origin = uri.getScheme() + "://" + uri.getAuthority();
            return properties.allowedOrigins().contains(origin) && endpoint.length() <= 512;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    /** Reaches the distributor through its internal address when configured (same path and query). */
    String internal(String endpoint) {
        if (properties.internalOrigin().isBlank()) return endpoint;
        URI uri = URI.create(endpoint);
        return properties.internalOrigin().replaceAll("/$", "") + uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
    }
}
