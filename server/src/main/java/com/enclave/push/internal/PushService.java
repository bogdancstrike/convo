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
import java.time.Duration;
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
    /** Posts one wake; returns the HTTP status (throws on transport failure). Replaceable in tests. */
    interface Transport { int post(String url, String payload) throws Exception; }
    /** Outcome of one attempt. */
    enum Outcome { DELIVERED, RETRY, GONE, REJECTED }

    private final Transport transport;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Map<DeviceAddress, Instant> lastWake = new ConcurrentHashMap<>();
    private final Map<DeviceAddress, Instant> lastUrgent = new ConcurrentHashMap<>();

    @org.springframework.beans.factory.annotation.Autowired
    PushService(JdbcClient jdbc, PushProperties properties, Clock clock) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.clock = clock;
        HttpClient http = HttpClient.newBuilder().connectTimeout(properties.timeout()).followRedirects(HttpClient.Redirect.NEVER).build();
        this.transport = (url, payload) -> http.send(HttpRequest.newBuilder(URI.create(url)).timeout(properties.timeout())
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(payload)).build(),
                HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    PushService(JdbcClient jdbc, PushProperties properties, Clock clock, Transport transport) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.clock = clock;
        this.transport = transport;
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
        DeviceAddress device = event.device();
        executor.submit(() -> deliver(device, endpoint, payload));
    }

    @ApplicationModuleListener
    void on(DeviceRevoked event) {
        unregister(event.address());
        lastWake.remove(event.address());
        lastUrgent.remove(event.address());
    }

    /**
     * Sends one wake with bounded retries (exponential backoff on a virtual thread). A distributor
     * that no longer knows the endpoint (404/410) causes it to be forgotten; the app registers a
     * new one the next time it runs.
     */
    Outcome deliver(DeviceAddress device, String endpoint, String payload) {
        Duration delay = properties.retryBackoff();
        Outcome outcome = Outcome.RETRY;
        for (int attempt = 1; attempt <= properties.maxAttempts(); attempt++) {
            outcome = attempt(endpoint, payload);
            if (outcome != Outcome.RETRY) break;
            if (attempt < properties.maxAttempts()) {
                try { Thread.sleep(delay); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
                delay = delay.multipliedBy(2);
            }
        }
        switch (outcome) {
            case GONE -> jdbc.sql("DELETE FROM push_endpoints WHERE account_id = :a AND device_id = :d AND endpoint = :e")
                    .param("a", device.accountId()).param("d", device.deviceId()).param("e", endpoint).update();
            case RETRY -> log.info("Push wake gave up after {} attempts", properties.maxAttempts());
            case REJECTED -> log.info("Push wake rejected by distributor");
            case DELIVERED -> { }
        }
        return outcome;
    }

    private Outcome attempt(String endpoint, String payload) {
        try {
            return classify(transport.post(internal(endpoint), payload));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Outcome.REJECTED;
        } catch (Exception e) {
            return Outcome.RETRY; // connection refused, timeout, DNS
        }
    }

    static Outcome classify(int status) {
        if (status >= 200 && status < 300) return Outcome.DELIVERED;
        if (status == 404 || status == 410) return Outcome.GONE;
        if (status == 429 || status >= 500) return Outcome.RETRY;
        return Outcome.REJECTED;
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
