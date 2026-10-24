package com.enclave.attachments.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.contracts.AttachmentPolicy;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import java.security.MessageDigest;
import java.util.List;
import java.util.Base64;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Attachment use cases: upload forms, download URLs and retention (specs §7). */
@Service
class AttachmentService {

    private static final Logger log = LoggerFactory.getLogger(AttachmentService.class);
    private static final int PURGE_BATCH = 500;
    private static final java.security.SecureRandom RANDOM = new java.security.SecureRandom();

    private final AttachmentRepository attachments;
    private final ObjectStore store;
    private final AttachmentsProperties properties;
    private final Clock clock;
    private final AttachmentPolicy policy;
    private final org.springframework.context.ApplicationEventPublisher events;

    AttachmentService(AttachmentRepository attachments, ObjectStore store, AttachmentsProperties properties, Clock clock, AttachmentPolicy policy, org.springframework.context.ApplicationEventPublisher events) {
        this.attachments = attachments;
        this.store = store;
        this.properties = properties;
        this.clock = clock;
        this.policy = policy;
        this.events = events;
    }

    /**
     * Registers a new attachment and presigns its upload.
     *
     * @param size exact encrypted (padded) size in bytes
     */
    @Transactional
    UploadForm createUpload(long size, String endpoint) {
        if (size <= 0 || size > policy.maxCiphertextBytes()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "attachment size out of range");
        }
        UUID id = UUID.randomUUID();
        String key = "a/" + id;
        Instant now = clock.instant();
        attachments.insert(id, key, size, now.plus(properties.retention()));
        var form = new UploadForm(id, store.presignUpload(key, size, properties.uploadUrlTtl(), endpoint), now.plus(properties.uploadUrlTtl()));
        events.publishEvent(new com.enclave.contracts.HandledOperation(com.enclave.contracts.HandledOperation.Kind.UPLOAD_STARTED));
        return form;
    }

    /** Size and part count of a multipart upload (all parts {@code partSize} except the last). */
    static int partCount(long size, long partSize) { return (int) ((size + partSize - 1) / partSize); }
    static long partLength(long size, long partSize, int partNumber) {
        return Math.min(partSize, size - (partNumber - 1) * partSize);
    }

    /**
     * Starts a resumable upload. The returned secret (shown once, stored hashed) is required to
     * presign parts and complete; the attachment ID alone is not enough.
     */
    @Transactional
    MultipartForm createMultipart(long size) {
        if (size <= 0 || size > policy.maxCiphertextBytes()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "attachment size out of range");
        }
        UUID id = UUID.randomUUID();
        String key = "a/" + id;
        byte[] secret = new byte[32];
        RANDOM.nextBytes(secret);
        Instant now = clock.instant();
        Instant deadline = now.plus(properties.multipartTtl());
        attachments.insertMultipart(id, key, size, now.plus(properties.retention()), store.createMultipart(key), sha256(secret), deadline);
        events.publishEvent(new com.enclave.contracts.HandledOperation(com.enclave.contracts.HandledOperation.Kind.UPLOAD_STARTED));
        return new MultipartForm(id, Base64.getUrlEncoder().withoutPadding().encodeToString(secret), properties.partSize(), partCount(size, properties.partSize()), deadline);
    }

    /** Presigned URLs for the given part numbers (at most 64 per call). */
    @Transactional(readOnly = true)
    List<PartUrl> presignParts(UUID id, String secret, List<Integer> partNumbers, String endpoint) {
        var upload = openUpload(id, secret);
        int count = partCount(upload.size(), properties.partSize());
        if (partNumbers == null || partNumbers.isEmpty() || partNumbers.size() > 64 || partNumbers.stream().anyMatch(n -> n == null || n < 1 || n > count)) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "invalid part numbers");
        }
        return partNumbers.stream().distinct().map(n -> new PartUrl(n,
                store.presignPart(upload.objectKey(), upload.uploadId(), n, partLength(upload.size(), properties.partSize(), n), properties.uploadUrlTtl(), endpoint))).toList();
    }

    /** Part numbers already stored with the expected length (for resuming). */
    @Transactional(readOnly = true)
    List<Integer> uploadedParts(UUID id, String secret) {
        var upload = openUpload(id, secret);
        return validParts(upload).stream().map(ObjectStore.Part::number).sorted().toList();
    }

    /** Completes the upload once every part is present with its exact length. Idempotent. */
    @Transactional
    void completeMultipart(UUID id, String secret) {
        var upload = authorized(id, secret);
        if (upload.completed()) return;
        if (upload.deadline().isBefore(clock.instant())) throw new EnclaveException(ErrorCode.NOT_FOUND, "upload expired");
        List<ObjectStore.Part> parts = validParts(upload);
        if (parts.size() != partCount(upload.size(), properties.partSize())) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "upload incomplete");
        }
        store.completeMultipart(upload.objectKey(), upload.uploadId(), parts.stream().sorted(java.util.Comparator.comparingInt(ObjectStore.Part::number)).toList());
        attachments.markCompleted(id);
    }

    private List<ObjectStore.Part> validParts(AttachmentRepository.Multipart upload) {
        return store.listParts(upload.objectKey(), upload.uploadId()).stream()
                .filter(p -> p.number() >= 1 && p.number() <= partCount(upload.size(), properties.partSize())
                        && p.size() == partLength(upload.size(), properties.partSize(), p.number()))
                .toList();
    }

    private AttachmentRepository.Multipart openUpload(UUID id, String secret) {
        var upload = authorized(id, secret);
        if (upload.completed() || upload.deadline().isBefore(clock.instant())) throw new EnclaveException(ErrorCode.NOT_FOUND, "upload closed");
        return upload;
    }

    /** Unknown upload and wrong secret look the same. */
    private AttachmentRepository.Multipart authorized(UUID id, String secret) {
        var upload = attachments.findMultipart(id).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "upload unknown"));
        byte[] given;
        try { given = Base64.getUrlDecoder().decode(secret == null ? "" : secret); } catch (IllegalArgumentException e) { given = new byte[0]; }
        if (!MessageDigest.isEqual(sha256(given), upload.secretHash())) throw new EnclaveException(ErrorCode.NOT_FOUND, "upload unknown");
        return upload;
    }

    private static byte[] sha256(byte[] value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value); } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    /** Presigns a download of a live attachment. */
    @Transactional(readOnly = true)
    Download download(UUID id, String endpoint) {
        String key = attachments.findLiveObjectKey(id)
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "attachment not found"));
        return new Download(store.presignDownload(key, properties.downloadUrlTtl(), endpoint), clock.instant().plus(properties.downloadUrlTtl()));
    }

    /** Explicit maintenance helper for expired objects and registry rows; never scheduled. */
    void purgeExpired() {
        // Abandoned resumable uploads first: abort so their parts do not linger in storage.
        for (String[] open : attachments.abandonedMultiparts(PURGE_BATCH)) {
            try {
                store.abortMultipart(open[0], open[1]);
                attachments.deleteByObjectKey(open[0]);
            } catch (RuntimeException e) {
                log.warn("Multipart abort failed for one upload ({}); will retry", e.getClass().getSimpleName());
                return;
            }
        }
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

    record MultipartForm(UUID attachmentId, String uploadSecret, long partSize, int partCount, Instant expiresAt) {}

    record PartUrl(int partNumber, String url) {}

    record Download(String downloadUrl, Instant expiresAt) {}
}
