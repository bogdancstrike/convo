package com.enclave.groups.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.util.Locale;

/** Group roles (specs §30.2). Persisted lower-case. */
public enum Role {
    /** Full control including role management and deletion. */
    OWNER,
    /** Membership management. */
    ADMIN,
    /** Ordinary participant. */
    MEMBER;

    /** @return persisted value */
    public String db() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** @return true for admin or owner */
    public boolean canManageMembers() {
        return this != MEMBER;
    }

    /** Parses a persisted or client-supplied role. */
    public static Role parse(String value) {
        try {
            return valueOf(value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "unknown role");
        }
    }
}
