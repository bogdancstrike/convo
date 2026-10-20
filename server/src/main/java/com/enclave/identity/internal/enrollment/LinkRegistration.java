package com.enclave.identity.internal.enrollment;

import com.enclave.identity.internal.keys.OneTimePreKey;
import com.enclave.identity.internal.keys.SignedPreKey;
import java.util.List;
import java.util.UUID;

/**
 * Command: register an additional device approved by an existing device (specs §4.4).
 *
 * @param provisioningId approved provisioning session
 * @param provisioningCode single-use code decrypted from the ProvisionMessage
 * @param identityKey account identity public key; must equal the account's current key
 * @param registrationId Signal registration ID of the new install
 * @param signedPreKey initial signed prekey (signed by the shared identity key)
 * @param oneTimePreKeys initial one-time prekeys
 * @param signingKey new device proof-of-possession public key (SPKI)
 * @param signingKeyProfile profile of {@code signingKey}
 * @param registrationProof signature over the {@link EnrollmentTranscript}
 * @param platform client platform
 * @param nameEnc owner-encrypted label, optional
 */
public record LinkRegistration(
        UUID provisioningId,
        String provisioningCode,
        byte[] identityKey,
        int registrationId,
        SignedPreKey signedPreKey,
        List<OneTimePreKey> oneTimePreKeys,
        byte[] signingKey,
        String signingKeyProfile,
        byte[] registrationProof,
        String platform,
        byte[] nameEnc) implements EnrollmentKeys {}
