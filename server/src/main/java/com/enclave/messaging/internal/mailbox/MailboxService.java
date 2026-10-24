package com.enclave.messaging.internal.mailbox;

import com.enclave.contracts.DeviceAddress;
import com.enclave.messaging.internal.MessagingProperties;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Mailbox drain, acknowledgement and retention (specs §10, §24.5). */
@Service
public class MailboxService {

    private static final Logger log = LoggerFactory.getLogger(MailboxService.class);
    private static final int PURGE_BATCH = 5_000;

    private final MailboxRepository mailbox;
    private final MessagingProperties properties;

    MailboxService(MailboxRepository mailbox, MessagingProperties properties) {
        this.mailbox = mailbox;
        this.properties = properties;
    }

    /**
     * @param device recipient device
     * @param limit requested page size, capped by configuration
     * @return oldest-first page
     */
    @Transactional(readOnly = true)
    public List<Envelope> page(DeviceAddress device, int limit) {
        return mailbox.page(device, Math.max(1, Math.min(limit, properties.drainPageSize())));
    }

    /** @return whether envelopes are pending for the device */
    @Transactional(readOnly = true)
    public boolean hasPending(DeviceAddress device) {
        return mailbox.hasPending(device);
    }

    /**
     * Acknowledges (deletes) envelopes. Unknown GUIDs are ignored, making acks idempotent.
     *
     * @return number deleted
     */
    @Transactional
    public int ack(DeviceAddress device, Collection<UUID> guids) {
        return mailbox.delete(device, guids);
    }

    /** Purges a revoked device's mailbox. */
    @Transactional
    public void purge(DeviceAddress device) {
        int n = mailbox.purge(device);
        log.info("Purged {} envelopes of revoked device {}", n, device);
    }

    /** Explicit maintenance helper for expired envelopes; never scheduled by the application. */
    @Transactional
    public void purgeExpired() {
        int n = mailbox.purgeExpired(PURGE_BATCH);
        if (n > 0) {
            log.debug("Expired {} envelopes", n);
        }
    }
}
