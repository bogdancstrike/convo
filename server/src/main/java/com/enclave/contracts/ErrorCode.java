package com.enclave.contracts;

import org.springframework.http.HttpStatus;

/**
 * Stable, client-visible error codes (specs §22).
 *
 * <p>Clients branch on {@link #name()}, never on the human-readable title, so names must not be
 * renamed once released. Add new codes at the end of a section and document the expected client
 * action in {@code docs.md}.
 */
public enum ErrorCode {
    // --- generic -------------------------------------------------------------------------------
    /** Request body/parameters failed validation. */
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "Invalid request"),
    /** Missing or invalid authentication. */
    UNAUTHENTICATED(HttpStatus.UNAUTHORIZED, "Authentication required"),
    /** Authenticated caller is not allowed to perform the action. */
    FORBIDDEN(HttpStatus.FORBIDDEN, "Forbidden"),
    /** Referenced resource does not exist or is not visible to the caller. */
    NOT_FOUND(HttpStatus.NOT_FOUND, "Not found"),
    /** Request exceeds a configured size or count limit. */
    PAYLOAD_TOO_LARGE(HttpStatus.CONTENT_TOO_LARGE, "Payload too large"),
    /** Caller exceeded a rate limit; honour {@code Retry-After}. */
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "Rate limited"),
    /** Organization policy forbids the requested value. */
    POLICY_VIOLATION(HttpStatus.UNPROCESSABLE_CONTENT, "Policy violation"),

    // --- identity ------------------------------------------------------------------------------
    /** Device credential was revoked; the client must wipe and sign out. */
    DEVICE_REVOKED(HttpStatus.UNAUTHORIZED, "Device revoked"),
    /** Account already has devices; use the link flow. */
    ACCOUNT_HAS_DEVICES(HttpStatus.CONFLICT, "Account already has devices"),
    /** Maximum active devices per account reached. */
    DEVICE_LIMIT(HttpStatus.FORBIDDEN, "Device limit reached"),
    /** Enrollment reservation/provisioning code is unknown, expired or already used. */
    ENROLLMENT_INVALID(HttpStatus.CONFLICT, "Enrollment no longer valid"),
    /** Account is disabled by the organization. */
    ACCOUNT_DISABLED(HttpStatus.FORBIDDEN, "Account disabled"),

    // --- messaging -----------------------------------------------------------------------------
    /** Recipient device list changed; body carries missing/extra/stale device IDs. */
    DEVICE_MISMATCH(HttpStatus.CONFLICT, "Device list mismatch"),
    /** Registration IDs changed (reinstall); re-establish sessions. */
    STALE_DEVICES(HttpStatus.GONE, "Stale devices"),
    /** Submission ID reused with different bytes. */
    IDEMPOTENCY_CONFLICT(HttpStatus.CONFLICT, "Submission ID reused with different content");

    private final HttpStatus status;
    private final String title;

    ErrorCode(HttpStatus status, String title) {
        this.status = status;
        this.title = title;
    }

    /** @return HTTP status used when this code is rendered as RFC 9457 problem details */
    public HttpStatus status() {
        return status;
    }

    /** @return short human-readable title; not a stable contract */
    public String title() {
        return title;
    }
}
