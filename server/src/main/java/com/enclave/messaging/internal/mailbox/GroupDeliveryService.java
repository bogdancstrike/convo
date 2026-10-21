package com.enclave.messaging.internal.mailbox;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.Uuids;
import com.enclave.messaging.DeliveryApi;
import com.enclave.messaging.GroupEnvelope;
import com.enclave.messaging.internal.MessagingProperties;
import com.enclave.messaging.internal.submission.EnvelopesStored;
import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link DeliveryApi} implementation: inserts group envelopes into recipients' mailboxes within the
 * caller's transaction and schedules after-commit signals.
 */
@Service
class GroupDeliveryService implements DeliveryApi {

    private final MailboxRepository mailbox;
    private final MessagingProperties properties;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    GroupDeliveryService(MailboxRepository mailbox, MessagingProperties properties, ApplicationEventPublisher events, Clock clock) {
        this.mailbox = mailbox;
        this.properties = properties;
        this.events = events;
        this.clock = clock;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void deliverGroup(Collection<DeviceAddress> recipients, GroupEnvelope envelope) {
        if (recipients.isEmpty()) {
            return;
        }
        Instant now = clock.instant();
        EnvelopeType type = switch (envelope.kind()) {
            case PRIVATE -> EnvelopeType.MLS_PRIVATE;
            case COMMIT -> EnvelopeType.MLS_COMMIT;
            case WELCOME -> EnvelopeType.MLS_WELCOME;
            case PROPOSAL -> EnvelopeType.MLS_PROPOSAL;
        };
        for (DeviceAddress to : recipients) {
            mailbox.insert(new Envelope(to, Uuids.v7(), type, envelope.source(), now, now.plus(properties.envelopeTtl()),
                    envelope.urgent(), envelope.content(), envelope.groupId(), envelope.epoch(),
                    envelope.groupSeq() == 0 ? null : envelope.groupSeq()));
        }
        events.publishEvent(new EnvelopesStored(List.copyOf(recipients), envelope.urgent()));
    }
}
