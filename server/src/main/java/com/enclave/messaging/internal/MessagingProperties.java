package com.enclave.messaging.internal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Messaging configuration ({@code enclave.messaging.*}); defaults from specs §26.3.
 *
 * @param envelopeTtl undelivered envelope retention
 * @param maxEnvelopeBytes maximum ciphertext size per device message
 * @param maxDevicesPerSend maximum device messages in one submission
 * @param drainPageSize envelopes per drain page
 * @param submissionRetention idempotency record retention (mailbox retention + grace)
 * @param maxTransientTtl upper bound for transient (typing/ICE) envelopes
 * @param maxMailboxBytes per-device mailbox quota
 * @param websocket WebSocket gateway settings
 */
@Validated
@ConfigurationProperties("enclave.messaging")
public record MessagingProperties(
        @DefaultValue("30d") @NotNull Duration envelopeTtl,
        @DefaultValue("262144") @Min(1024) int maxEnvelopeBytes,
        @DefaultValue("64") @Min(1) int maxDevicesPerSend,
        @DefaultValue("100") @Min(1) @Max(1000) int drainPageSize,
        @DefaultValue("31d") @NotNull Duration submissionRetention,
        @DefaultValue("30s") @NotNull Duration maxTransientTtl,
        @DefaultValue("104857600") @Min(1024) long maxMailboxBytes,
        @DefaultValue @Valid WebSocket websocket) {

    /**
     * @param ticketTtl lifetime of a one-use socket ticket (≤ 30 s per specs §9.1)
     * @param idleTimeout close sockets without client traffic for this long
     * @param maxFrameBytes maximum inbound text frame
     * @param sendBufferBytes per-session outbound buffer before the session is closed as slow
     * @param sendTimeLimit maximum time a single outbound send may block
     * @param allowedOrigins exact origins allowed to upgrade; empty means same host only
     */
    public record WebSocket(
            @DefaultValue("30s") @NotNull Duration ticketTtl,
            @DefaultValue("90s") @NotNull Duration idleTimeout,
            @DefaultValue("1048576") @Min(1024) int maxFrameBytes,
            @DefaultValue("4194304") @Min(1024) int sendBufferBytes,
            @DefaultValue("10s") @NotNull Duration sendTimeLimit,
            @DefaultValue List<String> allowedOrigins) {}
}
