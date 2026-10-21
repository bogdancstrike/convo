package com.enclave.identity;

/**
 * Verifies device proof-of-possession requests. Implemented by the identity module, used by the
 * platform HTTP security chain and by the WebSocket ticket endpoint.
 */
public interface DeviceRequestAuthenticator {

    /**
     * Verifies signature, expiry window, single use of the request ID and that the device is
     * active.
     *
     * @param request signed request inputs
     * @return the authenticated device
     * @throws com.enclave.contracts.EnclaveException {@code UNAUTHENTICATED} or
     *     {@code DEVICE_REVOKED} on failure
     */
    AuthenticatedDevice authenticate(SignedDeviceRequest request);

    /** A fresh single-use nonce for an authenticated device (returned with every response). */
    String issueNonce(com.enclave.contracts.DeviceAddress device);

    /**
     * Fresh nonces for a device that has none left (unauthenticated, bounded per device).
     *
     * @return nonces, or empty when the device is unknown or inactive
     */
    java.util.List<String> issueNonces(String deviceAddress);
}
