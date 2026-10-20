package com.enclave.identity.internal.enrollment;

import com.enclave.identity.internal.keys.OneTimePreKey;
import com.enclave.identity.internal.keys.SignedPreKey;
import java.util.List;
import java.util.UUID;

/**
 * Command: register the first device of an account (specs §4.3).
 *
 * @param reservationId reservation obtained from {@code POST /v1/devices/reservations}
 * @param identityKey account identity public key (33-byte serialized Curve25519)
 * @param registrationId Signal registration ID (1..16383)
 * @param signedPreKey initial signed prekey
 * @param oneTimePreKeys initial one-time prekeys
 * @param signingKey device proof-of-possession public key (SPKI)
 * @param signingKeyProfile profile ID of {@code signingKey}
 * @param registrationProof signature over the {@link EnrollmentTranscript}
 * @param platform client platform
 * @param nameEnc owner-encrypted device label, optional
 */
public record PrimaryRegistration(
        UUID reservationId,
        byte[] identityKey,
        int registrationId,
        SignedPreKey signedPreKey,
        List<OneTimePreKey> oneTimePreKeys,
        byte[] signingKey,
        String signingKeyProfile,
        byte[] registrationProof,
        String platform,
        byte[] nameEnc) implements EnrollmentKeys {}
