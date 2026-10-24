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
 * @param activity day-granular activity counts for the dashboard
 * @param idp sign-in account management at the identity provider
 */
@Validated
@ConfigurationProperties("enclave.admin")
public record AdminProperties(
        @DefaultValue("convo-admin") String role,
        @DefaultValue @jakarta.validation.Valid Roles roles,
        @DefaultValue("") String checkpointFile,
        @DefaultValue("15m") @NotNull Duration checkpointInterval,
        @DefaultValue("10m") @NotNull Duration stepUpMaxAge,
        @DefaultValue @jakarta.validation.Valid Activity activity,
        @DefaultValue @jakarta.validation.Valid Idp idp) {

    /**
     * @param enabled record encrypted items sent per account and day (counts only)
     * @param retention legacy explicit-maintenance threshold; no automatic deletion is performed
     */
    public record Activity(@DefaultValue("true") boolean enabled, @DefaultValue("90d") @NotNull Duration retention) {}

    /**
     * @param adminUrl Keycloak base URL including its relative path (e.g. {@code http://keycloak:8080/auth})
     * @param realm the Convo realm
     * @param clientId confidential client with realm-management manage-users/view-users only
     * @param clientSecret its secret (environment only); empty disables account management
     * @param timeout HTTP timeout per IdP call
     */
    public record Idp(@DefaultValue("http://localhost:8180/auth") java.net.URI adminUrl, @DefaultValue("enclave") String realm,
            @DefaultValue("convo-admin-ops") String clientId, @DefaultValue("") String clientSecret, @DefaultValue("5s") @NotNull Duration timeout) {}

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
