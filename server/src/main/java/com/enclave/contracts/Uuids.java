package com.enclave.contracts;

import java.security.SecureRandom;
import java.util.UUID;

/**
 * UUID helpers. Envelope GUIDs are UUIDv7 (RFC 9562) so they are time-ordered (specs §2).
 */
public final class Uuids {

    private static final SecureRandom RANDOM = new SecureRandom();

    private Uuids() {}

    /** @return a new random UUIDv7 using the current wall-clock millisecond */
    public static UUID v7() {
        long millis = System.currentTimeMillis();
        long randA = RANDOM.nextInt(1 << 12);
        long msb = (millis << 16) | (0x7L << 12) | randA;
        long lsb = (RANDOM.nextLong() & 0x3FFFFFFFFFFFFFFFL) | 0x8000000000000000L;
        return new UUID(msb, lsb);
    }
}
