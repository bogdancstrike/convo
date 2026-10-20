package com.enclave.identity.internal.enrollment;

import com.enclave.identity.internal.keys.OneTimePreKey;
import com.enclave.identity.internal.keys.SignedPreKey;
import java.util.List;

/**
 * Public key material and proof submitted by any enrolling device (primary or linked).
 * Implemented by {@link PrimaryRegistration} and {@link LinkRegistration}.
 */
public interface EnrollmentKeys {

    /** @return account identity public key (33-byte serialized Curve25519) */
    byte[] identityKey();

    /** @return Signal registration ID (1..16383) */
    int registrationId();

    /** @return initial signed prekey */
    SignedPreKey signedPreKey();

    /** @return initial one-time prekeys */
    List<OneTimePreKey> oneTimePreKeys();

    /** @return device proof-of-possession public key (SPKI) */
    byte[] signingKey();

    /** @return profile of {@link #signingKey()} */
    String signingKeyProfile();

    /** @return signature over the {@link EnrollmentTranscript} */
    byte[] registrationProof();

    /** @return client platform */
    String platform();

    /** @return owner-encrypted device label, optional */
    byte[] nameEnc();
}
