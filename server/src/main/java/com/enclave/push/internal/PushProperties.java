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
 */
@Validated
@ConfigurationProperties("enclave.push")
public record PushProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue List<String> allowedOrigins,
        @DefaultValue("") String internalOrigin,
        @DefaultValue("30s") @NotNull Duration minInterval,
        @DefaultValue("3s") @NotNull Duration urgentMinInterval,
        @DefaultValue("5s") @NotNull Duration timeout) {}
