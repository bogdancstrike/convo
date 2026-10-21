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
import java.sql.Timestamp;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Registers UnifiedPush endpoints and records content-free wake intents. An intent is written in
 * the transaction that stores the envelopes ({@link MailWaiting} is published before commit), so
 * no wake is lost between commit and enqueue; {@link PushDispatcher} delivers it.
 */
@Service
class PushService {
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
    /** Runs after an intent commits, so a wake usually leaves within milliseconds, not a poll later. */
    private volatile Runnable nudge = () -> { };

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

    void onIntent(Runnable nudge) { this.nudge = nudge; }

    void register(DeviceAddress device, String endpoint) {
        if (!allowed(endpoint)) throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "push distributor not allowed");
        jdbc.sql("""
                INSERT INTO push_endpoints (account_id, device_id, endpoint) VALUES (:a, :d, :e)
                ON CONFLICT (account_id, device_id) DO UPDATE SET endpoint = EXCLUDED.endpoint, updated_at = now()""")
                .param("a", device.accountId()).param("d", device.deviceId()).param("e", endpoint).update();
    }

    void unregister(DeviceAddress device) {
        jdbc.sql("DELETE FROM push_endpoints WHERE account_id = :a AND device_id = :d").param("a", device.accountId()).param("d", device.deviceId()).update();
        jdbc.sql("DELETE FROM push_intents WHERE account_id = :a AND device_id = :d").param("a", device.accountId()).param("d", device.deviceId()).update();
    }

    /**
     * Synchronous listener: joins the envelope transaction. One pending intent per device and kind;
     * later mail coalesces into it. Devices without a registered endpoint get nothing.
     */
    @EventListener
    void on(MailWaiting event) {
        if (!properties.enabled()) return;
        Instant now = clock.instant();
        int added = jdbc.sql("""
                INSERT INTO push_intents (account_id, device_id, urgent, due_at, expires_at)
                SELECT CAST(:a AS uuid), CAST(:d AS int), CAST(:u AS boolean), CAST(:now AS timestamptz), CAST(:expires AS timestamptz) FROM push_endpoints WHERE account_id = :a AND device_id = :d
                ON CONFLICT (account_id, device_id, urgent) DO NOTHING""")
                .param("a", event.device().accountId()).param("d", event.device().deviceId()).param("u", event.urgent())
                .param("now", Timestamp.from(now)).param("expires", Timestamp.from(now.plus(event.urgent() ? properties.urgentTtl() : properties.intentTtl())))
                .update();
        if (added == 0) return;
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { nudge.run(); }
            });
        } else {
            nudge.run();
        }
    }

    @ApplicationModuleListener
    void on(DeviceRevoked event) {
        unregister(event.address());
    }

    /** One delivery attempt to the distributor (no redirects, bounded timeout). */
    Outcome attempt(String endpoint, String payload) {
        try {
            return classify(transport.post(internal(endpoint), payload));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Outcome.RETRY;
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
