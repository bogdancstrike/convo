package com.enclave.identity.internal.web;

import com.enclave.identity.DeviceRequestAuthenticator;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Issues single-use device-proof nonces (PRIV-02) when a device has none left — e.g. after start
 * or after {@code NONCE_INVALID}. Unauthenticated by necessity; a nonce is useless without the
 * device's signature, is bound to that device, short-lived, and live nonces per device are capped.
 */
@RestController
class DeviceNonceController {
    record NonceRequest(String device) {}

    private final DeviceRequestAuthenticator authenticator;
    DeviceNonceController(DeviceRequestAuthenticator authenticator) { this.authenticator = authenticator; }

    @PostMapping("/v1/device-nonces")
    ResponseEntity<Map<String, List<String>>> nonces(@RequestBody NonceRequest body) {
        List<String> nonces = body == null || body.device() == null ? List.of() : authenticator.issueNonces(body.device());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("nonces", nonces));
    }
}
