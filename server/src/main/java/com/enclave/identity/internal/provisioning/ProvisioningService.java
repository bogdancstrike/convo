package com.enclave.identity.internal.provisioning;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Device-linking sessions (specs §4.4, §27.1; task ID-02).
 *
 * <p>Flow: the new device opens a session with its X25519 ephemeral key (Keycloak-authenticated);
 * an existing device of the same account lists open sessions, compares the transcript code with
 * the user, requests a single-use provisioning code, and delivers the end-to-end encrypted
 * ProvisionMessage. The new device then registers through {@code POST /v1/devices/link}, which
 * calls {@link #authorizeLink}. The server only relays ciphertext and verifies the code hash.
 */
@Service
public class ProvisioningService {

    /** Maximum size of the relayed encrypted ProvisionMessage. */
    static final int MAX_MESSAGE_BYTES = 16 * 1024;
    private static final int X25519_KEY_BYTES = 32;

    private final ProvisioningRepository sessions;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    ProvisioningService(ProvisioningRepository sessions, Clock clock) {
        this.sessions = sessions;
        this.clock = clock;
    }

    /**
     * Opens a session for a reserved link address.
     *
     * @param accountId account (from the Keycloak token)
     * @param reservationId reservation created with purpose {@code link}
     * @param ephemeralPublic new device's raw X25519 public key
     * @param clientLabel short label such as "Firefox on Linux"
     * @param expiresAt session expiry (normally the reservation expiry)
     */
    @Transactional
    public ProvisioningSession open(UUID accountId, UUID reservationId, byte[] ephemeralPublic, String clientLabel,
            Instant expiresAt) {
        if (ephemeralPublic == null || ephemeralPublic.length != X25519_KEY_BYTES) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "ephemeralPublicKey must be a raw X25519 key");
        }
        String label = sanitizeLabel(clientLabel);
        ProvisioningSession session = new ProvisioningSession(UUID.randomUUID(), accountId, reservationId, ephemeralPublic,
                label, "pending", null, null, null, null, clock.instant(), expiresAt);
        sessions.insert(session);
        return session;
    }

    /** @return a session of the given account (new device polling) */
    @Transactional(readOnly = true)
    public ProvisioningSession get(UUID accountId, UUID provisioningId) {
        return sessions.find(provisioningId).filter(s -> s.accountId().equals(accountId))
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown provisioning session"));
    }

    /** @return open sessions the account's existing devices may approve */
    @Transactional(readOnly = true)
    public List<ProvisioningSession> openSessions(UUID accountId) {
        return sessions.openForAccount(accountId);
    }

    /** Cancels a session (new device gave up, or an existing device declined). */
    @Transactional
    public void cancel(UUID accountId, UUID provisioningId) {
        ProvisioningSession s = lockOwned(accountId, provisioningId);
        if (!"completed".equals(s.status())) {
            sessions.setStatus(s.provisioningId(), "cancelled");
            sessions.clearMessage(s.provisioningId());
        }
    }

    /**
     * Issues the single-use provisioning code to an existing device, proving its consent to link
     * exactly this session. Only the code hash is stored; the code travels inside the E2EE message.
     *
     * @param approver authenticated existing device
     * @return the code (base64url, 128 bits)
     */
    @Transactional
    public String issueCode(DeviceAddress approver, UUID provisioningId) {
        ProvisioningSession s = lockOwned(approver.accountId(), provisioningId);
        requireOpen(s);
        if (!"pending".equals(s.status())) {
            throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "session already approved");
        }
        if (s.approverDevice() != null && s.approverDevice() != approver.deviceId()) {
            throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "another device is approving this session");
        }
        byte[] code = new byte[16];
        random.nextBytes(code);
        String encoded = Base64Url.encode(code);
        sessions.setCode(s.provisioningId(), sha256(encoded), approver.deviceId());
        return encoded;
    }

    /**
     * Stores the encrypted ProvisionMessage for the new device.
     *
     * @param approver device that requested the code
     * @param messagePublic approver's raw X25519 ephemeral public key
     * @param message IV || AES-GCM ciphertext
     */
    @Transactional
    public void deliver(DeviceAddress approver, UUID provisioningId, byte[] messagePublic, byte[] message) {
        ProvisioningSession s = lockOwned(approver.accountId(), provisioningId);
        requireOpen(s);
        if (!"pending".equals(s.status()) || s.approverDevice() == null || s.approverDevice() != approver.deviceId()) {
            throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "request a provisioning code first");
        }
        if (messagePublic == null || messagePublic.length != X25519_KEY_BYTES) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "ephemeralPublicKey must be a raw X25519 key");
        }
        if (message == null || message.length == 0 || message.length > MAX_MESSAGE_BYTES) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "invalid provisioning message");
        }
        sessions.setMessage(s.provisioningId(), messagePublic, message);
    }

    /**
     * Verifies a link request inside the enrollment transaction (row-locked).
     *
     * @param accountId account from the new device's Keycloak token
     * @param code provisioning code decrypted by the new device
     * @return the session, approved and code-verified (or already completed for idempotent retries)
     */
    @Transactional
    public ProvisioningSession authorizeLink(UUID accountId, UUID provisioningId, String code) {
        ProvisioningSession s = lockOwned(accountId, provisioningId);
        boolean retry = "completed".equals(s.status());
        if (!retry) {
            requireOpen(s);
            if (!"approved".equals(s.status())) {
                throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "session not approved");
            }
        }
        if (s.codeHash() == null || code == null || !MessageDigest.isEqual(s.codeHash(), sha256(code))) {
            throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "invalid provisioning code");
        }
        return s;
    }

    /** Marks the session completed and deletes the relayed ciphertext. */
    @Transactional
    public void complete(UUID provisioningId) {
        sessions.setStatus(provisioningId, "completed");
        sessions.clearMessage(provisioningId);
    }

    @Transactional
    void purgeExpired() {
        sessions.purgeExpired();
    }

    private ProvisioningSession lockOwned(UUID accountId, UUID provisioningId) {
        return sessions.lock(provisioningId).filter(s -> s.accountId().equals(accountId))
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown provisioning session"));
    }

    private void requireOpen(ProvisioningSession s) {
        if (!s.open(clock.instant())) {
            throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "provisioning session expired or closed");
        }
    }

    /** Keeps labels short, printable and single-line; they are shown on the approving device. */
    static String sanitizeLabel(String label) {
        String cleaned = label == null ? "" : label.replaceAll("[\\p{Cntrl}\\p{Cf}]", " ").strip();
        if (cleaned.isEmpty()) {
            cleaned = "New device";
        }
        return cleaned.length() > 64 ? cleaned.substring(0, 64) : cleaned;
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
