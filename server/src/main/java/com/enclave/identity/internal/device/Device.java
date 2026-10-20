package com.enclave.identity.internal.device;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Persistent device (table {@code devices}). Holds public material only.
 *
 * @param accountId owning account
 * @param deviceId device number
 * @param registrationId Signal registration ID
 * @param signingKey SPKI-encoded proof-of-possession public key
 * @param keyProfile signing algorithm/canonicalization profile
 * @param nameEnc owner-encrypted label (opaque to the server)
 * @param platform client platform
 * @param createdAt enrollment time
 * @param lastSeenDay coarse activity (day granularity)
 * @param revokedAt revocation time, {@code null} while active
 */
public record Device(
        UUID accountId,
        int deviceId,
        int registrationId,
        byte[] signingKey,
        String keyProfile,
        byte[] nameEnc,
        String platform,
        Instant createdAt,
        LocalDate lastSeenDay,
        Instant revokedAt) {

    /** @return whether the device is currently active */
    public boolean active() {
        return revokedAt == null;
    }
}
