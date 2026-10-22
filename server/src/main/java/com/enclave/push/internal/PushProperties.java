package com.enclave.push.internal;

import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * {@code enclave.push.*}.
 *
 * @param enabled whether wake-ups are sent
 * @param allowedOrigins distributor origins devices may register (e.g. {@code http://convo.example:8091})
 * @param internalOrigin optional origin the server uses to reach the distributor (Compose service
 *     name); a registered endpoint on an allowed origin is rewritten to it
 * @param minInterval at most one wake per device per interval
 * @param urgentMinInterval at most one urgent wake (call ring) per device per interval
 * @param timeout HTTP timeout for one wake
 * @param maxAttempts attempts per wake (transport errors, 429 and 5xx are retried)
 * @param retryBackoff delay before the first retry; doubles per attempt
 * @param intentTtl how long a message wake intent may wait (then it is dead-lettered as expired)
 * @param urgentTtl how long an urgent (call ring) intent may wait; a late ring is useless
 * @param pollInterval how often workers look for due intents (a hint also triggers a poll)
 * @param lease how long a claimed intent is reserved for one worker before others may retry it
 * @param batchSize intents claimed per poll
 * @param deadLetterRetention how long sanitized dead letters are kept (specs: diagnostics ≤ 24 h)
 * @param webPush browser Web Push (VAPID) for closed tabs
 */
@Validated
@ConfigurationProperties("enclave.push")
public record PushProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue List<String> allowedOrigins,
        @DefaultValue("") String internalOrigin,
        @DefaultValue("30s") @NotNull Duration minInterval,
        @DefaultValue("3s") @NotNull Duration urgentMinInterval,
        @DefaultValue("5s") @NotNull Duration timeout,
        @DefaultValue("4") @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(10) int maxAttempts,
        @DefaultValue("2s") @NotNull Duration retryBackoff,
        @DefaultValue("1h") @NotNull Duration intentTtl,
        @DefaultValue("60s") @NotNull Duration urgentTtl,
        @DefaultValue("1s") @NotNull Duration pollInterval,
        @DefaultValue("30s") @NotNull Duration lease,
        @DefaultValue("50") @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(1000) int batchSize,
        @DefaultValue("24h") @NotNull Duration deadLetterRetention,
        @DefaultValue @NotNull WebPush webPush) {

    /**
     * {@code enclave.push.web-push.*}: wakes for browsers whose Convo tab is closed. The browser's
     * push service (Google, Mozilla, Apple, Microsoft) receives an empty, VAPID-signed request.
     *
     * @param enabled offer Web Push to browsers (requires the key pair)
     * @param publicKey base64url uncompressed P-256 public key (browsers subscribe with it)
     * @param privateKey base64url P-256 private scalar (secret)
     * @param subject contact the push services may use ({@code mailto:} or {@code https:})
     * @param hosts push-service hosts endpoints may point to; {@code *.} matches subdomains
     */
    public record WebPush(
            @DefaultValue("false") boolean enabled,
            @DefaultValue("") String publicKey,
            @DefaultValue("") String privateKey,
            @DefaultValue("mailto:admin@localhost") String subject,
            @DefaultValue({"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "*.notify.windows.com"}) List<String> hosts) {}
}
