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
}
