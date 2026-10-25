package com.enclave.identity.internal.account;

import java.util.UUID;

/**
 * Persistent account (table {@code accounts}).
 *
 * @param accountId application account ID
 * @param username organization handle ({@code [a-z0-9._-]{3,32}})
 * @param deviceListVersion monotonic device-list version
 * @param identityKey account identity public key, {@code null} before the first device registers
 * @param status {@code active} or {@code disabled}
 * @param displayName organization display name (IdP-managed), may be {@code null}
 * @param phone organization phone number (IdP-managed), may be {@code null}
 * @param guestUntil when a guest account expires; {@code null} for regular members
 * @param integration set when the account is a visible archive or bot integration
 */
public record Account(UUID accountId, String username, long deviceListVersion, byte[] identityKey, String status,
        String displayName, String phone, java.time.Instant guestUntil, Integration integration) {

    /**
     * @param kind {@code archive} or {@code bot}
     * @param retention what happens to content it receives, disclosed to everyone in chats with it
     */
    public record Integration(String kind, String retention) {}

    /** Before integrations existed (tests, fixtures). */
    public Account(UUID accountId, String username, long deviceListVersion, byte[] identityKey, String status,
            String displayName, String phone, java.time.Instant guestUntil) {
        this(accountId, username, deviceListVersion, identityKey, status, displayName, phone, guestUntil, null);
    }

    /** @return whether the organization has disabled the account */
    public boolean disabled() {
        return "disabled".equals(status);
    }
}
