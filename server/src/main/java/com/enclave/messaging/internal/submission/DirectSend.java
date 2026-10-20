package com.enclave.messaging.internal.submission;

import com.enclave.messaging.internal.mailbox.EnvelopeType;
import java.util.List;
import java.util.UUID;

/**
 * Command: deliver per-device ciphertexts to every active device of one account (specs §5.3,
 * {@code SendRequest}).
 *
 * @param destination recipient account (may be the sender's own account for sync/Note to self)
 * @param submissionId 16 random bytes, idempotency key scoped to the sending device
 * @param messages one ciphertext per destination device
 * @param urgent priority hint
 * @param transientTtlSeconds {@code > 0} for short-lived typing/ICE envelopes (no push)
 */
public record DirectSend(UUID destination, byte[] submissionId, List<DeviceMessage> messages, boolean urgent,
        int transientTtlSeconds) {

    /**
     * @param deviceId destination device
     * @param registrationId registration ID the sender's session was built for
     * @param type {@code CIPHERTEXT} or {@code PREKEY_MESSAGE}
     * @param content ciphertext
     */
    public record DeviceMessage(int deviceId, int registrationId, EnvelopeType type, byte[] content) {}
}
