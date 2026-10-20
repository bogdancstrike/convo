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
}
