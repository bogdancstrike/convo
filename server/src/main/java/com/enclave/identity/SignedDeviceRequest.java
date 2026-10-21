package com.enclave.identity;

/**
 * Raw inputs of a device-signed HTTP request, extracted by the transport layer and verified by
 * {@link DeviceRequestAuthenticator}.
 *
 * <p>The canonical signed string (profile {@code p256-ecdsa-sha256-v1}) is:
 * <pre>
 * ENCLAVE-REQ-V1\n
 * {METHOD}\n
 * {path?query}\n
 * {base64url(SHA-256(body))}\n
 * {account_id}.{device_id}\n
 * {request_id}\n
 * {expires_epoch_millis}
 * </pre>
 *
 * <p>Profile {@code ENCLAVE-REQ-V2} (PRIV-02) adds a single-use server-issued nonce after the
 * request ID: {@code ...{request_id}\n{nonce}\n{expires_epoch_millis}}.
 *
 * @param method upper-case HTTP method
 * @param pathAndQuery raw request path including the query string, exactly as sent
 * @param body request body bytes (empty array when absent)
 * @param deviceAddress {@code account_id.device_id} claimed by the caller
 * @param requestId caller-chosen single-use request ID (16–64 URL-safe characters)
 * @param expiresAtMillis epoch milliseconds after which the signature is invalid
 * @param signature IEEE P1363 ECDSA signature over the canonical string
 * @param nonce server-issued single-use nonce (V2), or {@code null} for the legacy V1 profile
 */
public record SignedDeviceRequest(
        String method,
        String pathAndQuery,
        byte[] body,
        String deviceAddress,
        String requestId,
        long expiresAtMillis,
        byte[] signature,
        String nonce) {

    /** Legacy V1 request (no server nonce). */
    public SignedDeviceRequest(String method, String pathAndQuery, byte[] body, String deviceAddress, String requestId,
            long expiresAtMillis, byte[] signature) {
        this(method, pathAndQuery, body, deviceAddress, requestId, expiresAtMillis, signature, null);
    }
}
