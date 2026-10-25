package com.enclave.identity;

import com.enclave.contracts.DeviceAddress;
import java.util.Optional;
import java.util.UUID;

/**
 * Query interface other modules use for authoritative identity state. Reads always hit the
 * primary database; callers inside a transaction get a consistent view for fan-out validation.
 */
public interface IdentityApi {

    /**
     * @param accountId account to look up
     * @return the active device roster, or empty if the account does not exist or is disabled
     */
    Optional<DeviceRoster> activeRoster(UUID accountId);

    /**
     * @param address device address
     * @return {@code true} when the device exists, is not revoked and its account is active
     */
    boolean isActive(DeviceAddress address);

    /**
     * Public key state for key transparency (specs §19.4): the account identity key and its active
     * devices (none while the account is disabled).
     *
     * @param accountId account to look up
     * @return empty if the account does not exist or has no identity key yet
     */
    Optional<KeyState> keyState(UUID accountId);

    /** Accounts that have an identity key (key-transparency backfill). */
    java.util.List<UUID> accountsWithIdentityKey();

    /**
     * @param identityKey account identity public key (Signal encoding)
     * @param roster active devices and device-list version
     */
    record KeyState(byte[] identityKey, DeviceRoster roster) {}
}
