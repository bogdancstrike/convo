package com.enclave.messaging.internal.submission;

import static org.assertj.core.api.Assertions.assertThat;

import com.enclave.messaging.internal.mailbox.EnvelopeType;
import com.enclave.messaging.internal.submission.DirectSend.DeviceMessage;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The idempotency digest must be order-independent but sensitive to every ciphertext byte. */
class SubmissionDigestTest {

    private static final UUID DESTINATION = UUID.fromString("3f1c2a7e-6b1d-4c2e-9a55-0d6f3e2b1a90");
    private static final byte[] ID = new byte[16];

    private static DirectSend send(List<DeviceMessage> messages) {
        return new DirectSend(DESTINATION, ID, messages, false, 0);
    }

    @Test
    void sameMessagesInAnyOrderProduceTheSameDigest() {
        var a = new DeviceMessage(1, 10, EnvelopeType.CIPHERTEXT, new byte[] {1, 2});
        var b = new DeviceMessage(2, 20, EnvelopeType.PREKEY_MESSAGE, new byte[] {3});
        assertThat(SubmissionService.digest(send(List.of(a, b)))).isEqualTo(SubmissionService.digest(send(List.of(b, a))));
    }

    @Test
    void anyChangedByteChangesTheDigest() {
        var original = SubmissionService.digest(send(List.of(new DeviceMessage(1, 10, EnvelopeType.CIPHERTEXT, new byte[] {1, 2}))));
        var changed = SubmissionService.digest(send(List.of(new DeviceMessage(1, 10, EnvelopeType.CIPHERTEXT, new byte[] {1, 3}))));
        var retyped = SubmissionService.digest(send(List.of(new DeviceMessage(1, 10, EnvelopeType.PREKEY_MESSAGE, new byte[] {1, 2}))));
        assertThat(changed).isNotEqualTo(original);
        assertThat(retyped).isNotEqualTo(original);
    }
}
