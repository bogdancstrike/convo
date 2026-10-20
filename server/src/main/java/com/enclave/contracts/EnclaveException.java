package com.enclave.contracts;

import java.util.Map;

/**
 * Domain exception carrying a stable {@link ErrorCode} and optional structured properties.
 *
 * <p>Thrown by any module; rendered as RFC 9457 problem details by the platform error handler.
 * {@code properties} become top-level problem members (e.g. {@code missing}, {@code stale} for
 * {@link ErrorCode#DEVICE_MISMATCH}). Never put secrets, keys or ciphertext into messages or
 * properties: they may reach logs.
 */
public class EnclaveException extends RuntimeException {

    private final ErrorCode code;
    private final transient Map<String, Object> properties;

    /**
     * @param code stable error code
     * @param detail sanitized human-readable detail
     */
    public EnclaveException(ErrorCode code, String detail) {
        this(code, detail, Map.of());
    }

    /**
     * @param code stable error code
     * @param detail sanitized human-readable detail
     * @param properties extra problem members; values must be JSON-serializable
     */
    public EnclaveException(ErrorCode code, String detail, Map<String, Object> properties) {
        super(detail);
        this.code = code;
        this.properties = Map.copyOf(properties);
    }

    /** @return the stable error code */
    public ErrorCode code() {
        return code;
    }

    /** @return extra problem-detail members (immutable) */
    public Map<String, Object> properties() {
        return properties;
    }
}
