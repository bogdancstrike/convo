package com.enclave.platform.security;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * {@code enclave.rate-limits.*}: per-device token buckets in Valkey (specs §20). Each rule allows
 * {@code capacity} requests at once and refills {@code capacity} per {@code period}; the first rule
 * whose method and path pattern match a request applies.
 *
 * @param enabled turn all limits off (tests of other behaviour, emergencies)
 * @param rules ordered rules; the defaults follow specs §20
 */
@Validated
@ConfigurationProperties("enclave.rate-limits")
public record RateLimitProperties(@DefaultValue("true") boolean enabled, List<Rule> rules) {

    /**
     * @param name label used in the Valkey key and the error detail
     * @param method HTTP method
     * @param pattern Spring path pattern, e.g. {@code /v1/messages/*}
     * @param capacity burst size
     * @param refill tokens added per {@code period}
     * @param period refill period
     */
    public record Rule(@NotBlank String name, @NotBlank String method, @NotBlank String pattern, @Min(1) int capacity, @Min(1) int refill,
                       @NotNull Duration period) {}

    public RateLimitProperties {
        if (rules == null || rules.isEmpty()) rules = DEFAULTS;
    }

    /** Specs §20 limits. */
    static final List<Rule> DEFAULTS = List.of(
            new Rule("send", "PUT", "/v1/messages/*", 120, 60, Duration.ofMinutes(1)),
            new Rule("group-send", "PUT", "/v1/groups/*/messages", 120, 60, Duration.ofMinutes(1)),
            new Rule("group-commit", "POST", "/v1/groups/*/commits", 30, 30, Duration.ofMinutes(1)),
            new Rule("prekey-claim", "POST", "/v1/keys/*/claim", 100, 100, Duration.ofHours(1)),
            new Rule("keypackage-claim", "POST", "/v1/keypackages/claim", 200, 200, Duration.ofHours(1)),
            new Rule("upload", "POST", "/v1/attachments/upload-form", 50, 50, Duration.ofHours(1)),
            new Rule("upload-multipart", "POST", "/v1/attachments/multipart", 50, 50, Duration.ofHours(1)),
            new Rule("directory", "GET", "/v1/directory/search", 60, 60, Duration.ofMinutes(1)));
}
