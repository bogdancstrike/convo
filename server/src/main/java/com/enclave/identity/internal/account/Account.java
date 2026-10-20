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
 */
public record Account(UUID accountId, String username, long deviceListVersion, byte[] identityKey, String status) {

    /** @return whether the organization has disabled the account */
    public boolean disabled() {
        return "disabled".equals(status);
    }
}
