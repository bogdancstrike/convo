package com.enclave.messaging.internal.gateway;

import com.enclave.contracts.DeviceAddress;
import com.enclave.identity.DeviceRegistered;
import com.enclave.identity.DeviceRevoked;
import com.enclave.identity.IdentityApi;
import com.enclave.identity.PrekeysLow;
import com.enclave.messaging.internal.mailbox.MailboxService;
import com.enclave.messaging.internal.submission.EnvelopesStored;
import java.util.UUID;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Reacts to messaging and identity events by signalling devices. Identity events are consumed via
 * Spring Modulith's persistent publication registry, so a crash between commit and handling is
 * retried rather than lost.
 */
@Component
class GatewayEventListener {

    private final HintBus hints;
    private final MailboxService mailbox;
    private final IdentityApi identity;
    private final DeviceSessionRegistry registry;

    GatewayEventListener(HintBus hints, MailboxService mailbox, IdentityApi identity, DeviceSessionRegistry registry) {
        this.hints = hints;
        this.mailbox = mailbox;
        this.identity = identity;
        this.registry = registry;
    }

    /** Store-then-notify: signal recipients only after the envelopes committed. */
    @TransactionalEventListener
    void on(EnvelopesStored event) {
        event.recipients().forEach(hints::signalMail);
    }

    /** Revocation: purge the mailbox, close sockets, tell the account's other devices. */
    @ApplicationModuleListener
    void on(DeviceRevoked event) {
        mailbox.purge(event.address());
        hints.signalControl(event.address(), Directive.REVOKED);
        notifyOwnDevices(event.address().accountId());
    }

    /** New device: tell the account's other devices to refresh their device list. */
    @ApplicationModuleListener
    void on(DeviceRegistered event) {
        notifyOwnDevices(event.address().accountId());
    }

    /** Ask the device to replenish one-time prekeys. */
    @ApplicationModuleListener
    void on(PrekeysLow event) {
        hints.signalControl(event.address(), Directive.KEYS_LOW);
    }

    /** Graceful shutdown: ask clients to reconnect to another replica (close code 4100). */
    @EventListener(ContextClosedEvent.class)
    void onShutdown() {
        registry.closeAll();
    }

    private void notifyOwnDevices(UUID accountId) {
        identity.activeRoster(accountId).ifPresent(roster -> roster.devices().forEach(d ->
                hints.signalControl(new DeviceAddress(accountId, d.deviceId()), Directive.DEVICE_LIST_CHANGED)));
    }
}
