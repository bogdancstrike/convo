package com.enclave.attachments.internal;

import java.net.URI;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * S3-compatible object storage adapter (SeaweedFS, Garage, Ceph RGW; ADR-016). Presigning uses
 * the public endpoint so URLs are reachable by browsers; administration uses the internal one.
 */
@Component
class ObjectStore implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(ObjectStore.class);

    private final AttachmentsProperties properties;
    private final S3Client client;


    ObjectStore(AttachmentsProperties properties) {
        this.properties = properties;
        var credentials = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(properties.accessKey(), properties.secretKey()));
        var s3Config = S3Configuration.builder().pathStyleAccessEnabled(properties.pathStyle()).build();
        this.client = S3Client.builder()
                .endpointOverride(URI.create(properties.endpoint()))
                .region(Region.of(properties.region()))
                .credentialsProvider(credentials)
                .serviceConfiguration(s3Config)
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
                .httpClient(UrlConnectionHttpClient.create())
                .build();

    }

    private S3Presigner presigner(String endpoint) {
        return S3Presigner.builder().endpointOverride(URI.create(endpoint))
                .region(Region.of(properties.region()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(properties.accessKey(), properties.secretKey())))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(properties.pathStyle()).build())
                .build();
    }

    /** Creates the bucket when configured and missing; failures are logged, not fatal. */
    @EventListener(ApplicationReadyEvent.class)
    void ensureBucket() {
        if (!properties.createBucket()) {
            return;
        }
        try {
            client.headBucket(HeadBucketRequest.builder().bucket(properties.bucket()).build());
        } catch (NoSuchBucketException e) {
            client.createBucket(b -> b.bucket(properties.bucket()));
            log.info("Created attachment bucket {}", properties.bucket());
        } catch (RuntimeException e) {
            log.warn("Attachment bucket check failed ({}); uploads will fail until storage is reachable", e.getClass().getSimpleName());
        }
    }

    /** @return presigned PUT URL bound to the exact content length */
    String presignUpload(String key, long size, Duration ttl, String endpoint) {
        PutObjectRequest put = PutObjectRequest.builder().bucket(properties.bucket()).key(key)
                .contentLength(size).contentType("application/octet-stream").build();
        try (var signer = presigner(endpoint)) {
            return signer.presignPutObject(r -> r.signatureDuration(ttl).putObjectRequest(put)).url().toString();
        }
    }

    /** @return presigned GET URL */
    String presignDownload(String key, Duration ttl, String endpoint) {
        GetObjectRequest get = GetObjectRequest.builder().bucket(properties.bucket()).key(key).build();
        try (var signer = presigner(endpoint)) {
            return signer.presignGetObject(r -> r.signatureDuration(ttl).getObjectRequest(get)).url().toString();
        }
    }

    /** Deletes an object; missing objects are not an error. */
    void delete(String key) {
        client.deleteObject(b -> b.bucket(properties.bucket()).key(key));
    }

    @Override
    public void destroy() {
        client.close();
    }
}
