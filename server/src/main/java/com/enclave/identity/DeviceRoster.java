package com.enclave.identity;

import java.util.List;
import java.util.UUID;

/**
 * Snapshot of an account's active devices, used for multi-device fan-out validation (specs §5.3).
 *
 * @param accountId account
 * @param deviceListVersion monotonic version incremented on every device add/revoke
 * @param devices active devices
 */
public record DeviceRoster(UUID accountId, long deviceListVersion, List<Entry> devices) {

    /**
     * @param deviceId device number
     * @param registrationId Signal registration ID; changes on reinstall
     */
    public record Entry(int deviceId, int registrationId) {}
}
