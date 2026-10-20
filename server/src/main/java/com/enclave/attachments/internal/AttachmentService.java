package com.enclave.attachments.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Attachment use cases: upload forms, download URLs and retention (specs §7). */
@Service
class AttachmentService {

    private static final Logger log = LoggerFactory.getLogger(AttachmentService.class);
    private static final int PURGE_BATCH = 500;

    private final AttachmentRepository attachments;
    private final ObjectStore store;
    private final AttachmentsProperties properties;
    private final Clock clock;

    AttachmentService(AttachmentRepository attachments, ObjectStore store, AttachmentsProperties properties, Clock clock) {
        this.attachments = attachments;
        this.store = store;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Registers a new attachment and presigns its upload.
     *
     * @param size exact encrypted (padded) size in bytes
     */
    @Transactional
    UploadForm createUpload(long size, String endpoint) {
        if (size <= 0 || size > properties.maxBytes()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "attachment size out of range");
        }
        UUID id = UUID.randomUUID();
        String key = "a/" + id;
        Instant now = clock.instant();
        attachments.insert(id, key, size, now.plus(properties.retention()));
        return new UploadForm(id, store.presignUpload(key, size, properties.uploadUrlTtl(), endpoint), now.plus(properties.uploadUrlTtl()));
    }

    /** Presigns a download of a live attachment. */
    @Transactional(readOnly = true)
    Download download(UUID id, String endpoint) {
        String key = attachments.findLiveObjectKey(id)
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "attachment expired or unknown"));
        return new Download(store.presignDownload(key, properties.downloadUrlTtl(), endpoint), clock.instant().plus(properties.downloadUrlTtl()));
    }

    /** Deletes expired objects, then their registry rows (object first so nothing is orphaned). */
    @Scheduled(fixedDelayString = "${enclave.attachments.purge-interval:PT1H}")
    void purgeExpired() {
        for (String key : attachments.expiredObjectKeys(PURGE_BATCH)) {
            try {
                store.delete(key);
                attachments.deleteByObjectKey(key);
            } catch (RuntimeException e) {
                log.warn("Attachment purge failed for one object ({}); will retry", e.getClass().getSimpleName());
                return;
            }
        }
    }

    record UploadForm(UUID attachmentId, String uploadUrl, Instant expiresAt) {}

    record Download(String downloadUrl, Instant expiresAt) {}
}
