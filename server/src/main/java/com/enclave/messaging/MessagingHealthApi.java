package com.enclave.messaging;

import java.time.Duration;

/**
 * Aggregate messaging health for operators: counts and ages only, never accounts, devices or
 * content (specs §19 "do not expose per-user conversation graphs or presence dashboards").
 */
public interface MessagingHealthApi {

    /**
     * @param waitingEnvelopes encrypted envelopes stored for devices that have not fetched them yet
     * @param devicesWithBacklog devices with at least one waiting envelope
     * @param oldestWaiting age of the oldest waiting envelope ({@link Duration#ZERO} when none)
     * @param connectedSessions WebSocket sessions on this server instance (per pod)
     */
    record Health(long waitingEnvelopes, long devicesWithBacklog, Duration oldestWaiting, int connectedSessions) {}

    Health health();
}
