package com.enclave.identity.internal.enrollment;

import java.time.Instant;
import java.util.UUID;

/**
 * Enrollment reservation: a pre-allocated, never-reused device address plus a single-use
 * challenge (specs §4.3, §26.2 {@code enrollment_reservations}).
 *
 * @param reservationId reservation ID
 * @param accountId owning account
 * @param deviceId reserved device number
 * @param purpose {@code primary} or {@code link}
 * @param challenge random challenge bound into the enrollment transcript
 * @param expiresAt expiry
 * @param consumedAt consumption time, {@code null} if unused
 * @param acceptedKey SHA-256 of the accepted device signing key (idempotent retry detection)
 */
public record Reservation(
        UUID reservationId,
        UUID accountId,
        int deviceId,
        String purpose,
        byte[] challenge,
        Instant expiresAt,
        Instant consumedAt,
        byte[] acceptedKey) {}
