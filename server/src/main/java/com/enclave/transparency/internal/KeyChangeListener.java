package com.enclave.transparency.internal;

import com.enclave.identity.DeviceRegistered;
import com.enclave.identity.DeviceRevoked;
import com.enclave.identity.IdentityApi;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Feeds the log: synchronously, inside the identity transaction that registered or revoked a
 * device (the roster and its log entry commit together), and once at startup for accounts that
 * predate the log or changed while it was unavailable.
 */
@Component
class KeyChangeListener {
    private final TransparencyLog log;
    private final IdentityApi identity;

    KeyChangeListener(TransparencyLog log, IdentityApi identity) { this.log = log; this.identity = identity; }

    @EventListener
    void on(DeviceRegistered event) { log.record(java.util.List.of(event.address().accountId())); }

    @EventListener
    void on(DeviceRevoked event) { log.record(java.util.List.of(event.address().accountId())); }

    @EventListener(ApplicationReadyEvent.class)
    void backfill() { log.record(identity.accountsWithIdentityKey()); log.ensureMapRoot(); }
}
