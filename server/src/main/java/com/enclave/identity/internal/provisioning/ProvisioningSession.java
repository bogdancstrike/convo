package com.enclave.identity.internal.provisioning;

import java.time.Instant;
import java.util.UUID;

/**
 * A device-linking session (table {@code provisioning_sessions}).
 *
 * @param provisioningId session ID
 * @param accountId account being linked to
 * @param reservationId reservation holding the new device address and challenge
 * @param ephemeralPublic new device's X25519 public key
 * @param clientLabel short platform label shown to the approving device (e.g. "Firefox on Linux")
 * @param status {@code pending} → {@code approved} → {@code completed}, or {@code cancelled}
 * @param codeHash SHA-256 of the provisioning code, set when an existing device requests it
 * @param approverDevice existing device that requested the code
 * @param messagePublic approver's X25519 ephemeral public key
 * @param message encrypted ProvisionMessage (IV || ciphertext)
 * @param createdAt creation time
 * @param expiresAt expiry
 */
public record ProvisioningSession(
        UUID provisioningId,
        UUID accountId,
        UUID reservationId,
        byte[] ephemeralPublic,
        String clientLabel,
        String status,
        byte[] codeHash,
        Integer approverDevice,
        byte[] messagePublic,
        byte[] message,
        Instant createdAt,
        Instant expiresAt) {

    /** @return whether the session can still progress */
    public boolean open(Instant now) {
        return ("pending".equals(status) || "approved".equals(status)) && expiresAt.isAfter(now);
    }
}
