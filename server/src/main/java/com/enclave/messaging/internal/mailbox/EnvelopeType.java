package com.enclave.messaging.internal.mailbox;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;

/**
 * Envelope types (specs §9.2 {@code Envelope.Type}). Numeric codes are persisted and must never be
 * reused.
 */
public enum EnvelopeType {
    /** Signal whisper message on an established session. */
    CIPHERTEXT(1),
    /** Signal prekey message establishing a session. */
    PREKEY_MESSAGE(2),
    /** Sealed-sender message (PRIV-01). */
    UNIDENTIFIED_SENDER(3),
    /** MLS application message. */
    MLS_PRIVATE(4),
    /** MLS commit. */
    MLS_COMMIT(5),
    /** MLS welcome. */
    MLS_WELCOME(6),
    /** MLS standalone proposal. */
    MLS_PROPOSAL(7),
    /** Server-signed system event. */
    SERVER_EVENT(8);

    private final int code;

    EnvelopeType(int code) {
        this.code = code;
    }

    /** @return persisted numeric code */
    public int code() {
        return code;
    }

    /**
     * @param code persisted code
     * @return the type
     */
    public static EnvelopeType fromCode(int code) {
        for (EnvelopeType t : values()) {
            if (t.code == code) {
                return t;
            }
        }
        throw new IllegalStateException("unknown envelope type " + code);
    }

    /**
     * Parses a client-supplied type name.
     *
     * @param name enum name
     * @return the type
     * @throws EnclaveException {@code INVALID_REQUEST} for unknown names
     */
    public static EnvelopeType parse(String name) {
        try {
            return valueOf(name);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "unknown envelope type");
        }
    }
}
