package com.enclave.contracts;

import java.util.UUID;

/**
 * The unit of delivery: one device of one account (specs §2).
 *
 * @param accountId application account ID (UUIDv4, never the OIDC subject)
 * @param deviceId per-account device number, {@code 1..2^31-1}, never reused
 */
public record DeviceAddress(UUID accountId, int deviceId) {

    /** Validates the device ID range. */
    public DeviceAddress {
        if (accountId == null || deviceId < 1) {
            throw new IllegalArgumentException("invalid device address");
        }
    }

    /**
     * Parses the canonical {@code <account-uuid>.<device-id>} form.
     *
     * @param value textual address
     * @return parsed address
     * @throws EnclaveException {@link ErrorCode#INVALID_REQUEST} if malformed
     */
    public static DeviceAddress parse(String value) {
        int dot = value == null ? -1 : value.lastIndexOf('.');
        if (dot <= 0) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "malformed device address");
        }
        try {
            return new DeviceAddress(UUID.fromString(value.substring(0, dot)),
                    Integer.parseInt(value.substring(dot + 1)));
        } catch (IllegalArgumentException e) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "malformed device address");
        }
    }

    /** @return canonical {@code <account-uuid>.<device-id>} form, used in Valkey keys and logs */
    @Override
    public String toString() {
        return accountId + "." + deviceId;
    }
}
