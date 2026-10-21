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
 * @param role Keycloak realm role with every admin permission (superuser)
 * @param roles scoped admin roles (least privilege, specs §19)
 * @param checkpointFile append-only file (ideally on separate, write-once storage) that receives the
 *     audit chain head; empty disables checkpointing
 * @param checkpointInterval how often a new head is written when the chain grew
 * @param stepUpMaxAge sensitive actions require an IdP sign-in (token {@code auth_time}) at most this old
 */
@Validated
@ConfigurationProperties("enclave.admin")
public record AdminProperties(
        @DefaultValue("convo-admin") String role,
        @DefaultValue @jakarta.validation.Valid Roles roles,
        @DefaultValue("") String checkpointFile,
        @DefaultValue("15m") @NotNull Duration checkpointInterval,
        @DefaultValue("10m") @NotNull Duration stepUpMaxAge) {

    /**
     * @param helpdesk device/status support: read accounts and devices, revoke a device
     * @param orgAdmin membership: read accounts, disable/enable accounts
     * @param security incidents: accounts, devices, revocation, disable, read audit
     * @param auditor read, verify, export and checkpoint the audit log only
     */
    public record Roles(
            @DefaultValue("convo-helpdesk") String helpdesk,
            @DefaultValue("convo-org-admin") String orgAdmin,
            @DefaultValue("convo-security") String security,
            @DefaultValue("convo-auditor") String auditor) {}

    Path checkpointPath() { return checkpointFile.isBlank() ? null : Path.of(checkpointFile); }
}
