package com.enclave.push.internal;

import com.enclave.push.internal.PushIntentStore.Claimed;
import com.enclave.push.internal.PushIntentStore.Target;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Delivers durable wake intents (specs §15, MSG-02). Each replica polls for due intents and claims
 * a batch under a lease ({@code FOR UPDATE SKIP LOCKED}), so replicas never send the same intent
 * concurrently and a crashed worker's lease simply expires. A committed intent also nudges an
 * immediate poll; the periodic poll is the safety net when that hint is lost.
 *
 * <p>Outcomes: delivered → intent removed and the per-device rate limit stamped; distributor
 * dropped the topic (404/410) → endpoint forgotten; transport error/429/5xx → retried with
 * exponential backoff up to {@code max-attempts}; other 4xx, too many attempts or expiry →
 * sanitized dead letter (device, kind, reason, attempts; no endpoint or content).
 */
@Component
class PushDispatcher implements SmartLifecycle {
    private static final Logger log = LoggerFactory.getLogger(PushDispatcher.class);
    private static final Duration PURGE_EVERY = Duration.ofMinutes(10);

    private final PushIntentStore store;
    private final PushService push;
    private final PushProperties properties;
    private final Clock clock;
    private ScheduledExecutorService scheduler;

    PushDispatcher(PushIntentStore store, PushService push, PushProperties properties, Clock clock) {
        this.store = store;
        this.push = push;
        this.properties = properties;
        this.clock = clock;
    }

    @Override public synchronized void start() {
        if (!properties.enabled() || scheduler != null) return;
        scheduler = Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().name("push-dispatcher").daemon().factory());
        scheduler.scheduleWithFixedDelay(this::safePoll, properties.pollInterval().toMillis(), properties.pollInterval().toMillis(), TimeUnit.MILLISECONDS);
        scheduler.scheduleWithFixedDelay(this::safePurge, PURGE_EVERY.toMillis(), PURGE_EVERY.toMillis(), TimeUnit.MILLISECONDS);
        push.onIntent(() -> { ScheduledExecutorService s = scheduler; if (s != null && !s.isShutdown()) s.execute(this::safePoll); });
    }

    @Override public synchronized void stop() {
        push.onIntent(() -> { });
        if (scheduler != null) scheduler.shutdownNow();
        scheduler = null;
    }

    @Override public synchronized boolean isRunning() { return scheduler != null; }

    private void safePoll() {
        try {
            while (poll() == properties.batchSize()) { /* drain a backlog without waiting a full interval */ }
        } catch (RuntimeException e) {
            log.warn("Push dispatch poll failed: {}", e.getClass().getSimpleName());
        }
    }

    private void safePurge() {
        try { purge(); } catch (RuntimeException e) { log.warn("Push dead-letter purge failed: {}", e.getClass().getSimpleName()); }
    }

    /** Claims and handles one batch of due intents; returns how many were claimed. */
    int poll() {
        Instant now = clock.instant();
        List<Claimed> claimed = store.claim(now, now.plus(properties.lease()), properties.batchSize());
        if (claimed.isEmpty()) return 0;
        // Distributors are independent: one slow endpoint must not hold up the rest of the batch.
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            claimed.forEach(c -> workers.submit(() -> handle(c)));
        }
        return claimed.size();
    }

    /** One delivery attempt for a claimed intent, and what happens to the intent afterwards. */
    void handle(Claimed c) {
        Instant now = clock.instant();
        if (now.isAfter(c.expiresAt())) { dead(c, "expired", now); return; }
        Target target = store.target(c).orElse(null);
        if (target == null || !push.allowed(target.endpoint())) { store.remove(c); return; }
        Instant last = c.urgent() ? target.lastUrgent() : target.lastWake();
        Duration interval = c.urgent() ? properties.urgentMinInterval() : properties.minInterval();
        // A wake within the interval already prompts the device to connect and drain everything.
        if (last != null && last.plus(interval).isAfter(now)) { store.remove(c); return; }
        switch (push.attempt(target.endpoint(), c.urgent() ? PushService.URGENT : PushService.WAKE)) {
            case DELIVERED -> store.delivered(c, now);
            case GONE -> store.forgetEndpoint(c, target.endpoint());
            case REJECTED -> dead(c, "rejected", now);
            case RETRY -> {
                if (c.attempts() >= properties.maxAttempts()) { dead(c, "gave_up", now); return; }
                store.retryAt(c, now.plus(properties.retryBackoff().multipliedBy(1L << Math.min(c.attempts() - 1, 20))));
            }
        }
    }

    private void dead(Claimed c, String reason, Instant now) {
        store.dead(c, reason, now);
        log.info("Push wake dead-lettered: {}", reason);
    }

    /** Diagnostics are kept only for the retention window (specs: intent outcomes ≤ 24 h). */
    int purge() {
        return store.purge(clock.instant().minus(properties.deadLetterRetention()));
    }
}
