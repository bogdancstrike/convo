package com.enclave.identity.internal.web;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.AuthenticatedDevice;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * MLS device bindings (GRP-01). A device publishes its long-lived MLS signature public key together
 * with an XEdDSA signature by the account identity key; members fetch an account's bindings to check
 * that a KeyPackage or group leaf really belongs to that account. The server stores and serves them
 * but cannot forge one, and serves only active (non-revoked) devices.
 */
@RestController
class MlsBindingController {
    record PublishBinding(@NotBlank @Size(max = 64) String signatureKey, @NotBlank @Size(max = 128) String binding) {}
    record BindingDto(int deviceId, String signatureKey, String binding) {}

    private final JdbcClient jdbc;

    MlsBindingController(JdbcClient jdbc) { this.jdbc = jdbc; }

    /** The calling device's binding (replaces an earlier one, e.g. after a signer reset). */
    @PutMapping("/v1/devices/self/mls-binding")
    ResponseEntity<Void> publish(@AuthenticationPrincipal AuthenticatedDevice device, @Valid @RequestBody PublishBinding body) {
        byte[] key = Base64Url.decode(body.signatureKey(), "signatureKey");
        byte[] binding = Base64Url.decode(body.binding(), "binding");
        if (key.length != 32 || binding.length != 64) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "signatureKey must be 32 bytes and binding 64 bytes");
        jdbc.sql("""
                INSERT INTO mls_device_bindings (account_id, device_id, signature_key, binding) VALUES (:a, :d, :k, :b)
                ON CONFLICT (account_id, device_id) DO UPDATE SET signature_key = EXCLUDED.signature_key, binding = EXCLUDED.binding, updated_at = now()""")
                .param("a", device.accountId()).param("d", device.address().deviceId()).param("k", key).param("b", binding).update();
        return ResponseEntity.noContent().build();
    }

    /** Bindings of an account's active devices (devices without one are simply absent). */
    @GetMapping("/v1/accounts/{accountId}/mls-bindings")
    List<BindingDto> bindings(@AuthenticationPrincipal AuthenticatedDevice device, @PathVariable UUID accountId) {
        return jdbc.sql("""
                SELECT b.device_id, b.signature_key, b.binding FROM mls_device_bindings b
                  JOIN devices d ON d.account_id = b.account_id AND d.device_id = b.device_id AND d.revoked_at IS NULL
                 WHERE b.account_id = :a ORDER BY b.device_id""")
                .param("a", accountId)
                .query((rs, n) -> new BindingDto(rs.getInt("device_id"), Base64Url.encode(rs.getBytes("signature_key")), Base64Url.encode(rs.getBytes("binding")))).list();
    }
}
