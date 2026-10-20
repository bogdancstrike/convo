package com.enclave.attachments.internal;

import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Attachment endpoints (specs §12.5). Device-authenticated by the platform security chain; the
 * caller identity is intentionally not recorded with the attachment.
 */
@RestController
class AttachmentController {

    private final AttachmentService attachments;
    private final com.enclave.contracts.DeploymentProperties deployment;
    private final AttachmentsProperties properties;

    AttachmentController(AttachmentService attachments, com.enclave.contracts.DeploymentProperties deployment, AttachmentsProperties properties) {
        this.attachments = attachments;
        this.deployment = deployment;
        this.properties = properties;
    }

    /** Registers an attachment and returns a presigned upload URL. */
    @PostMapping("/v1/attachments/upload-form")
    @ResponseStatus(HttpStatus.CREATED)
    AttachmentService.UploadForm uploadForm(@RequestBody UploadRequest body) {
        return attachments.createUpload(body.size(), publicEndpoint());
    }

    /** Returns a short-lived presigned download URL. */
    @GetMapping("/v1/attachments/{attachmentId}")
    ResponseEntity<AttachmentService.Download> download(@PathVariable UUID attachmentId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(attachments.download(attachmentId, publicEndpoint()));
    }

    private String publicEndpoint() {
        String origin = org.springframework.web.servlet.support.ServletUriComponentsBuilder.fromCurrentContextPath().build().toUriString();
        return deployment.endpointFor(properties.publicEndpoint(), origin);
    }

    /** @param size exact encrypted size in bytes */
    record UploadRequest(long size) {}
}
