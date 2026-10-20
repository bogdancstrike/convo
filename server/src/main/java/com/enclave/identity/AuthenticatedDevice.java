package com.enclave.identity;

import com.enclave.contracts.DeviceAddress;
import java.util.UUID;

/**
 * Security principal of a request authenticated with a device proof-of-possession signature
 * (specs §4.2). Inject it in controllers with {@code @AuthenticationPrincipal}.
 *
 * @param address the authenticated, currently active device
 * @param platform device platform ({@code web}, {@code android}, ...)
 */
public record AuthenticatedDevice(DeviceAddress address, String platform) {

    /** @return the account the device belongs to */
    public UUID accountId() {
        return address.accountId();
    }

    /** @return the per-account device number */
    public int deviceId() {
        return address.deviceId();
    }
}
