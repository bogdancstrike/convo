package com.enclave.identity;

import java.util.UUID;

/**
 * Published (inside the request transaction) the first time a device makes an authenticated
 * request on a UTC day: "this person used Convo today on this platform". No content, no peers.
 *
 * @param accountId account
 * @param deviceId device number
 * @param platform {@code web}, {@code android}, …
 */
public record DeviceActiveToday(UUID accountId, int deviceId, String platform) {}
