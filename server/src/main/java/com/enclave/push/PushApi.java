package com.enclave.push;

import java.time.Duration;
import java.util.Map;

/**
 * Aggregate wake-delivery health for operators (no device, account or endpoint identifiers) and
 * the dead-letter redrive control (specs §15, MSG-02).
 */
public interface PushApi {

    /**
     * @param pending wake intents waiting for delivery or retry
     * @param oldestPending age of the oldest pending intent ({@link Duration#ZERO} when none)
     * @param deadLetters dead letters in the retention window, keyed {@code reason/kind}
     *     (e.g. {@code gave_up/message}, {@code expired/call})
     */
    record Health(long pending, Duration oldestPending, Map<String, Long> deadLetters) {}

    Health health();

    /**
     * Re-queues dead-lettered message wakes (not expired call rings, which are useless late) as
     * fresh intents for devices that still have an endpoint, then clears them.
     *
     * @return wakes re-queued
     */
    int redrive();
}
