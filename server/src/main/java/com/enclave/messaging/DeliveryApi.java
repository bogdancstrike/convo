package com.enclave.messaging;

import com.enclave.contracts.DeviceAddress;
import java.util.Collection;

/**
 * Mailbox delivery for other modules (groups). Envelopes are inserted in the <em>caller's</em>
 * transaction, so a group commit and its fan-out are accepted atomically (specs §26.1); online
 * devices are signalled after commit.
 */
public interface DeliveryApi {

    /**
     * Queues one copy of {@code envelope} for every recipient device.
     *
     * @param recipients active recipient devices (the sending device should not be included)
     * @param envelope MLS envelope
     */
    void deliverGroup(Collection<DeviceAddress> recipients, GroupEnvelope envelope);

    /**
     * Content-free hint (after commit) that a group's server state changed without an MLS commit
     * (e.g. a member left or was removed on their behalf): clients refresh and complete removals.
     */
    void groupChanged(Collection<DeviceAddress> devices);
}
