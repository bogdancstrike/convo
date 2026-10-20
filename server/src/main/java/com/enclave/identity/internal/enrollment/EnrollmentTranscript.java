package com.enclave.identity.internal.enrollment;

import com.enclave.contracts.Base64Url;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * Canonical enrollment transcript signed by the new device's proof-of-possession key
 * (specs §27.1). Binds deployment, reserved address, reservation challenge, the account identity
 * key and the registration ID, so the server cannot swap any of them after the fact.
 *
 * <pre>
 * ENCLAVE-ENROLL-V1\n
 * {deployment_id}\n
 * {account_id}.{device_id}\n
 * {reservation_id}\n
 * {base64url(challenge)}\n
 * {base64url(identity_key)}\n
 * {registration_id}\n
 * {base64url(SHA-256(device_signing_public_key_spki))}
 * </pre>
 */
public final class EnrollmentTranscript {

    private EnrollmentTranscript() {}

    /**
     * @return UTF-8 transcript bytes
     */
    public static byte[] build(String deploymentId, UUID accountId, int deviceId, UUID reservationId,
            byte[] challenge, byte[] identityKey, int registrationId, byte[] signingKeySpki) {
        String text = "ENCLAVE-ENROLL-V1\n" + deploymentId + "\n" + accountId + "." + deviceId + "\n"
                + reservationId + "\n" + Base64Url.encode(challenge) + "\n" + Base64Url.encode(identityKey) + "\n"
                + registrationId + "\n" + Base64Url.encode(sha256(signingKeySpki));
        return text.getBytes(StandardCharsets.UTF_8);
    }

    static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
