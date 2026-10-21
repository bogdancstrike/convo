package com.enclave.attachments.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.enclave.contracts.AttachmentPolicy;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class MultipartUploadTest {
    private static final long MIB = 1024 * 1024;
    private final Instant now = Instant.parse("2026-10-21T12:00:00Z");
    private final AttachmentRepository repository = mock(AttachmentRepository.class);
    private final ObjectStore store = mock(ObjectStore.class);
    private final AttachmentsProperties properties = new AttachmentsProperties("http://s3", "http://public", "us-east-1", "b", "a", "s",
            true, false, Duration.ofMinutes(15), Duration.ofMinutes(5), Duration.ofDays(30), 8 * MIB, Duration.ofHours(24));
    private final AttachmentService service = new AttachmentService(repository, store, properties, Clock.fixed(now, ZoneOffset.UTC), new AttachmentPolicy(100));
    private final long size = 20 * MIB + 5; // 3 parts: 8, 8, 4 MiB + 5 B

    private String start(UUID[] id) {
        when(store.createMultipart(anyString())).thenReturn("up-1");
        var form = service.createMultipart(size);
        ArgumentCaptor<byte[]> hash = ArgumentCaptor.forClass(byte[].class);
        verify(repository).insertMultipart(eq(form.attachmentId()), eq("a/" + form.attachmentId()), eq(size), any(), eq("up-1"), hash.capture(), eq(now.plus(Duration.ofHours(24))));
        when(repository.findMultipart(form.attachmentId())).thenReturn(Optional.of(
                new AttachmentRepository.Multipart("a/" + form.attachmentId(), size, "up-1", hash.getValue(), now.plus(Duration.ofHours(24)), false)));
        id[0] = form.attachmentId();
        assertThat(form.partCount()).isEqualTo(3);
        assertThat(form.partSize()).isEqualTo(8 * MIB);
        return form.uploadSecret();
    }

    @Test void partsHaveExactLengths() {
        assertThat(AttachmentService.partCount(size, 8 * MIB)).isEqualTo(3);
        assertThat(AttachmentService.partLength(size, 8 * MIB, 1)).isEqualTo(8 * MIB);
        assertThat(AttachmentService.partLength(size, 8 * MIB, 3)).isEqualTo(4 * MIB + 5);
        assertThat(AttachmentService.partCount(8 * MIB, 8 * MIB)).isEqualTo(1);
    }

    @Test void theAttachmentIdAloneCannotContinueOrCompleteAnUpload() {
        UUID[] id = new UUID[1];
        String secret = start(id);
        for (String wrong : new String[] {null, "", "AAAA", secret.substring(1) + "A"}) {
            assertThatThrownBy(() -> service.presignParts(id[0], wrong, List.of(1), "http://public"))
                    .isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.NOT_FOUND));
            assertThatThrownBy(() -> service.completeMultipart(id[0], wrong)).isInstanceOf(EnclaveException.class);
        }
        when(store.presignPart(anyString(), eq("up-1"), anyInt(), anyLong(), any(), anyString())).thenReturn("http://public/part");
        assertThat(service.presignParts(id[0], secret, List.of(1, 3), "http://public")).hasSize(2);
        verify(store).presignPart("a/" + id[0], "up-1", 3, 4 * MIB + 5, Duration.ofMinutes(15), "http://public");
        assertThatThrownBy(() -> service.presignParts(id[0], secret, List.of(4), "http://public")).isInstanceOf(EnclaveException.class);
    }

    @Test void completionRequiresEveryPartWithItsExactLength() {
        UUID[] id = new UUID[1];
        String secret = start(id);
        String key = "a/" + id[0];
        when(store.listParts(key, "up-1")).thenReturn(List.of(new ObjectStore.Part(1, "e1", 8 * MIB), new ObjectStore.Part(3, "e3", 4 * MIB + 5),
                new ObjectStore.Part(2, "e2", 8 * MIB - 1)));
        assertThat(service.uploadedParts(id[0], secret)).containsExactly(1, 3);
        assertThatThrownBy(() -> service.completeMultipart(id[0], secret)).isInstanceOf(EnclaveException.class);
        verify(store, never()).completeMultipart(anyString(), anyString(), anyList());

        when(store.listParts(key, "up-1")).thenReturn(List.of(new ObjectStore.Part(3, "e3", 4 * MIB + 5), new ObjectStore.Part(1, "e1", 8 * MIB),
                new ObjectStore.Part(2, "e2", 8 * MIB)));
        service.completeMultipart(id[0], secret);
        verify(store).completeMultipart(eq(key), eq("up-1"), argThat(parts -> parts.stream().map(ObjectStore.Part::number).toList().equals(List.of(1, 2, 3))));
        verify(repository).markCompleted(id[0]);
    }
}
