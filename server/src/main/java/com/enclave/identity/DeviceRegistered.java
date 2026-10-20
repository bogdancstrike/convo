package com.enclave.identity;

import com.enclave.contracts.DeviceAddress;

/**
 * Domain event: a device completed enrollment. Published inside the registering transaction.
 *
 * @param address the new device
 * @param deviceListVersion account device-list version after the change
 */
public record DeviceRegistered(DeviceAddress address, long deviceListVersion) {}
