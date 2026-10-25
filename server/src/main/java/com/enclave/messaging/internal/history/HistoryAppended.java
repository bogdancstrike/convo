package com.enclave.messaging.internal.history;

import com.enclave.contracts.DeviceAddress;

/**
 * An entry was added to an account's encrypted history; the account's other devices are told to
 * pull (instead of polling). Carries no content.
 *
 * @param source the device that appended (it does not need the notice)
 */
public record HistoryAppended(DeviceAddress source) {}
