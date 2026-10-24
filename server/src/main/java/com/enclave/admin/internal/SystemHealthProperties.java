package com.enclave.admin.internal;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Deployment-owned health targets; none can be supplied by an HTTP caller. */
@ConfigurationProperties("enclave.admin.health")
record SystemHealthProperties(
        @DefaultValue("2s") Duration timeout,
        @DefaultValue("10s") Duration cacheTtl,
        @DefaultValue("") String webUrl,
        @DefaultValue("") String adminUrl,
        @DefaultValue("") String operationsUrl,
        @DefaultValue("") String turnHost,
        @DefaultValue("3478") int turnPort) {
    SystemHealthProperties {
        if (timeout == null || timeout.isNegative() || timeout.isZero() || timeout.compareTo(Duration.ofSeconds(10)) > 0)
            throw new IllegalArgumentException("health timeout must be positive and at most 10 seconds");
        if (cacheTtl == null || cacheTtl.compareTo(Duration.ofSeconds(1)) < 0 || cacheTtl.compareTo(Duration.ofMinutes(5)) > 0)
            throw new IllegalArgumentException("health cache must be between 1 second and 5 minutes");
        if (turnPort < 1 || turnPort > 65535) throw new IllegalArgumentException("invalid TURN health port");
    }
}
