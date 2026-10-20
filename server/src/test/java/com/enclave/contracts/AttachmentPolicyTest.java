package com.enclave.contracts;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

class AttachmentPolicyTest {
    @Test void permitsAuthenticatedEncryptionPaddingWithoutChangingPlaintextLimit() {
        var policy = new AttachmentPolicy(100);
        assertThat(policy.maxFileBytes()).isEqualTo(104857600);
        long raw = 24 + policy.maxFileBytes() + 1600 * 16;
        assertThat(policy.maxCiphertextBytes()).isGreaterThanOrEqualTo(raw).isLessThanOrEqualTo((long) Math.ceil(raw * 1.05));
        assertThat(new AttachmentPolicy(1).maxFileBytes()).isEqualTo(1048576);
        assertThat(new AttachmentPolicy(1).maxCiphertextBytes()).isLessThan(policy.maxCiphertextBytes());
    }
}
