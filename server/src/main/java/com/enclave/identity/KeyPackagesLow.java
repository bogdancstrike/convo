package com.enclave.identity;

import com.enclave.contracts.DeviceAddress;

/**
 * Domain event: a device's MLS KeyPackage supply fell below the configured watermark; the gateway
 * turns it into a {@code KEYPACKAGES_LOW} directive.
 *
 * @param address device to replenish
 * @param remaining remaining KeyPackages
 */
public record KeyPackagesLow(DeviceAddress address, int remaining) {}
