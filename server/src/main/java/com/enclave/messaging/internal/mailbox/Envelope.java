package com.enclave.messaging.internal.mailbox;

import com.enclave.contracts.DeviceAddress;
import java.time.Instant;
import java.util.UUID;

/**
 * A queued ciphertext for one recipient device.
 *
 * @param recipient destination device
 * @param guid UUIDv7 envelope ID (client dedupe key)
 * @param type envelope type
 * @param source sending device, {@code null} for sealed/server envelopes
 * @param serverTimestamp acceptance time
 * @param expiresAt deletion deadline if never acknowledged
 * @param urgent priority hint
 * @param content opaque ciphertext
 */
public record Envelope(
        DeviceAddress recipient,
        UUID guid,
        EnvelopeType type,
        DeviceAddress source,
        Instant serverTimestamp,
        Instant expiresAt,
        boolean urgent,
        byte[] content) {}
