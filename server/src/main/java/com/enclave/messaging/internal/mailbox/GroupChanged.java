package com.enclave.messaging.internal.mailbox;

import com.enclave.contracts.DeviceAddress;
import java.util.List;

/**
 * Internal event: a group's membership changed without an MLS commit; the gateway signals these
 * devices ({@code GROUPS_CHANGED}) after commit.
 *
 * @param devices devices to signal
 */
public record GroupChanged(List<DeviceAddress> devices) {}
