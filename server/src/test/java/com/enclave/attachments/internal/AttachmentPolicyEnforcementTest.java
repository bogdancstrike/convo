package com.enclave.attachments.internal;

import com.enclave.contracts.AttachmentPolicy;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.time.Clock;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;

class AttachmentPolicyEnforcementTest {
    @Test void rejectsOversizedCiphertextBeforeCreatingAnObjectOrSigningAnUpload() {
        var repository = mock(AttachmentRepository.class);
        var objectStore = mock(ObjectStore.class);
        var policy = new AttachmentPolicy(1);
        var service = new AttachmentService(repository, objectStore, mock(AttachmentsProperties.class), Clock.systemUTC(), policy, mock(org.springframework.context.ApplicationEventPublisher.class));
        assertThatThrownBy(() -> service.createUpload(policy.maxCiphertextBytes() + 1, "https://example.test"))
                .isInstanceOfSatisfying(EnclaveException.class, e -> org.assertj.core.api.Assertions.assertThat(e.code()).isEqualTo(ErrorCode.PAYLOAD_TOO_LARGE));
        verifyNoInteractions(repository, objectStore);
    }
}
