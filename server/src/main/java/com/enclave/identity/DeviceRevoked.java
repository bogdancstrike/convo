package com.enclave.identity;

import com.enclave.contracts.DeviceAddress;

/**
 * Domain event: a device credential was revoked (user unlink, admin action, account disable).
 * Consumers must close sockets, purge mailboxes and stop fan-out (specs §4.7).
 *
 * @param address revoked device
 * @param deviceListVersion account device-list version after the change
 * @param reason sanitized reason: {@code unlinked}, {@code self}, {@code admin}, {@code disabled}
 */
public record DeviceRevoked(DeviceAddress address, long deviceListVersion, String reason) {}
