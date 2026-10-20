package com.enclave.attachments.internal;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Object storage settings ({@code enclave.attachments.*}).
 *
 * @param endpoint S3 endpoint reachable from the server (bucket administration, deletes)
 * @param publicEndpoint S3 endpoint as seen by clients; presigned URLs are generated for it
 * @param region signing region (any value for SeaweedFS/Garage)
 * @param bucket bucket name
 * @param accessKey access key ID
 * @param secretKey secret access key
 * @param pathStyle use path-style URLs ({@code endpoint/bucket/key})
 * @param createBucket create the bucket at start-up when missing (development convenience)
 * @param maxBytes maximum encrypted attachment size (specs §26.3: 100 MiB plus padding)
 * @param uploadUrlTtl presigned upload URL lifetime
 * @param downloadUrlTtl presigned download URL lifetime
 * @param retention object lifetime
 */
@Validated
@ConfigurationProperties("enclave.attachments")
public record AttachmentsProperties(
        @NotBlank @DefaultValue("http://localhost:8333") String endpoint,
        @NotBlank @DefaultValue("http://localhost:8088") String publicEndpoint,
        @NotBlank @DefaultValue("us-east-1") String region,
        @NotBlank @DefaultValue("enclave-attachments") String bucket,
        @NotBlank @DefaultValue("enclave-dev-access") String accessKey,
        @NotBlank @DefaultValue("enclave-dev-secret-change-me") String secretKey,
        @DefaultValue("true") boolean pathStyle,
        @DefaultValue("true") boolean createBucket,
        @DefaultValue("110100480") @Min(1024) long maxBytes,
        @DefaultValue("15m") @NotNull Duration uploadUrlTtl,
        @DefaultValue("5m") @NotNull Duration downloadUrlTtl,
        @DefaultValue("30d") @NotNull Duration retention) {}
