package com.enclave.messaging;

import com.enclave.contracts.DeviceAddress;

/**
 * Published after commit when envelopes were stored for a device that has no live connection, so
 * a wake-up channel (MSG-02 push) can prompt it to connect. Carries no content or sender.
 *
 * @param device device with waiting mail
 * @param urgent sender's priority hint (call ring): wake immediately and ring
 */
public record MailWaiting(DeviceAddress device, boolean urgent) {}
