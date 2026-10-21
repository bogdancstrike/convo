package com.enclave.admin.internal;

import jakarta.validation.constraints.NotNull;
import java.nio.file.Path;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * {@code enclave.admin.*}.
 *
 * @param role Keycloak realm role required for the admin API and console
 * @param checkpointFile append-only file (ideally on separate, write-once storage) that receives the
 *     audit chain head; empty disables checkpointing
 * @param checkpointInterval how often a new head is written when the chain grew
 */
@Validated
@ConfigurationProperties("enclave.admin")
public record AdminProperties(
        @DefaultValue("convo-admin") String role,
        @DefaultValue("") String checkpointFile,
        @DefaultValue("15m") @NotNull Duration checkpointInterval) {

    Path checkpointPath() { return checkpointFile.isBlank() ? null : Path.of(checkpointFile); }
}
