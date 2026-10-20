package com.enclave.identity;

import com.enclave.contracts.DeviceAddress;

/**
 * Domain event: a device's one-time prekey supply fell below the configured watermark. The
 * gateway turns it into a {@code KEYS_LOW} directive.
 *
 * @param address device to replenish
 * @param remaining remaining one-time prekeys
 */
public record PrekeysLow(DeviceAddress address, int remaining) {}
