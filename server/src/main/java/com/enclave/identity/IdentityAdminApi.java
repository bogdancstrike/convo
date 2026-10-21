package com.enclave.identity;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Organization-administration operations on accounts and devices (used by the {@code admin}
 * module). Exposes directory metadata only — never keys, message content or contact graphs.
 */
public interface IdentityAdminApi {

    /**
     * @param accountId account ID
     * @param username organization handle
     * @param displayName IdP display name, may be {@code null}
     * @param status {@code active} or {@code disabled}
     * @param activeDevices number of non-revoked devices
     */
    record AccountSummary(UUID accountId, String username, String displayName, String status, int activeDevices) {}

    /**
     * @param deviceId per-account device number
     * @param platform {@code web}, {@code android}, …
     * @param createdAt enrollment time
     * @param lastSeenDay coarse last activity day, may be {@code null}
     */
    record DeviceSummary(int deviceId, String platform, Instant createdAt, LocalDate lastSeenDay) {}

    /** Accounts (including disabled ones) whose handle or display name contains the query. */
    List<AccountSummary> searchAccounts(String query, int limit);

    Optional<AccountSummary> account(UUID accountId);

    /** Active devices of an account. */
    List<DeviceSummary> devices(UUID accountId);

    /**
     * Disables or re-enables an account. Disabled accounts fail every device-authenticated request
     * and drop out of the directory and fan-out; their devices are kept so re-enabling restores them.
     */
    void setDisabled(UUID accountId, boolean disabled);

    /** Revokes one device (same effects as a user unlinking it). */
    void revokeDevice(UUID accountId, int deviceId, String reason);
}
