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
     * @param createdAt first sign-in (account creation)
     * @param lastSeenDay most recent day any of its devices was active (day granularity), may be {@code null}
     */
    record AccountSummary(UUID accountId, String username, String displayName, String status, int activeDevices,
            Instant createdAt, LocalDate lastSeenDay) {}

    /**
     * Directory totals (counts only).
     *
     * @param accounts all accounts
     * @param disabled disabled accounts
     * @param devices active (non-revoked) devices
     * @param seenToday accounts with a device active today
     * @param seen7d accounts with a device active in the last 7 days
     * @param seen30d accounts with a device active in the last 30 days
     */
    record DirectoryStats(long accounts, long disabled, long devices, long seenToday, long seen7d, long seen30d) {}

    /** A count for one day. */
    record DayCount(LocalDate day, long count) {}

    /**
     * @param deviceId per-account device number
     * @param platform {@code web}, {@code android}, …
     * @param createdAt enrollment time
     * @param lastSeenDay coarse last activity day, may be {@code null}
     */
    record DeviceSummary(int deviceId, String platform, Instant createdAt, LocalDate lastSeenDay) {}

    /** Accounts (including disabled ones) whose handle or display name contains the query. */
    List<AccountSummary> searchAccounts(String query, int limit);

    /** Paged source for admin directory queries; filtering/sorting happens before final paging. */
    List<AccountSummary> accountDirectory(int offset, int limit);

    Optional<AccountSummary> account(UUID accountId);

    /** Active devices of an account. */
    List<DeviceSummary> devices(UUID accountId);

    /**
     * Disables or re-enables an account. Disabled accounts fail every device-authenticated request
     * and drop out of the directory and fan-out; their devices are kept so re-enabling restores them.
     */
    void setDisabled(UUID accountId, boolean disabled);

    /** Marks an IdP subject as a guest until {@code expiresAt} (replacing an earlier expiry). */
    void markGuest(String subject, java.time.Instant expiresAt, String invitedBy);

    /** Guest subjects whose expiry has passed and has not been applied yet. */
    List<String> dueGuests(java.time.Instant now);

    /** Guest status of an IdP subject: expiry and when it was applied; empty for members. */
    Optional<GuestStatus> guest(String subject);

    record GuestStatus(java.time.Instant expiresAt, java.time.Instant expiredAt) {}

    /** Records that a guest's expiry was applied. */
    void guestExpired(String subject, java.time.Instant at);

    /** Revokes one device (same effects as a user unlinking it). */
    void revokeDevice(UUID accountId, int deviceId, String reason);

    DirectoryStats directoryStats(LocalDate today);

    /** Accounts created per day since {@code from} (days without any are omitted). */
    List<DayCount> newAccountsPerDay(LocalDate from);

    /** Active accounts seen least recently first (never-seen first): candidates for follow-up. */
    List<AccountSummary> leastRecentlySeen(int limit);

    /** Accounts by ID (unknown IDs are skipped). */
    List<AccountSummary> accounts(java.util.Collection<UUID> accountIds);

    /** Convo accounts for IdP subjects (accounts are created on first sign-in). */
    java.util.Map<String, UUID> accountsBySubject(java.util.Collection<String> subjects);

    /** The IdP subject of an account. */
    Optional<String> subject(UUID accountId);

    /**
     * Deletes the account's server-side recovery registration (wrapped history key + authorization
     * hash), so a lost or leaked recovery kit no longer works. The user's devices keep working and
     * the app asks for a new recovery code. Returns whether one existed.
     */
    boolean revokeRecovery(UUID accountId);
}
