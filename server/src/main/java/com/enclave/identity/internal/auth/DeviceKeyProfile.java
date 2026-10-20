package com.enclave.identity.internal.auth;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.X509EncodedKeySpec;

/**
 * Supported device proof-of-possession key profiles (specs §4.2, PRIV-02).
 *
 * <p>{@link #P256_ECDSA_SHA256_V1}: NIST P-256 key exported by WebCrypto/Android Keystore as SPKI
 * DER; signatures are IEEE P1363 ({@code r||s}, 64 bytes), the native WebCrypto format. New
 * profiles are added as new constants; existing ones are never changed in place.
 */
public enum DeviceKeyProfile {
    /** ECDSA P-256 with SHA-256, P1363 signature encoding. */
    P256_ECDSA_SHA256_V1("p256-ecdsa-sha256-v1", "EC", "SHA256withECDSAinP1363Format", 256);

    private final String id;
    private final String keyAlgorithm;
    private final String signatureAlgorithm;
    private final int fieldSize;

    DeviceKeyProfile(String id, String keyAlgorithm, String signatureAlgorithm, int fieldSize) {
        this.id = id;
        this.keyAlgorithm = keyAlgorithm;
        this.signatureAlgorithm = signatureAlgorithm;
        this.fieldSize = fieldSize;
    }

    /** @return wire identifier stored in {@code devices.device_key_profile} */
    public String id() {
        return id;
    }

    /**
     * @param id wire identifier
     * @return matching profile
     * @throws EnclaveException {@code INVALID_REQUEST} for unknown profiles
     */
    public static DeviceKeyProfile fromId(String id) {
        for (DeviceKeyProfile p : values()) {
            if (p.id.equals(id)) {
                return p;
            }
        }
        throw new EnclaveException(ErrorCode.INVALID_REQUEST, "unsupported device key profile");
    }

    /**
     * Parses and validates an SPKI public key for this profile.
     *
     * @param spki DER-encoded SubjectPublicKeyInfo
     * @return the public key
     * @throws EnclaveException {@code INVALID_REQUEST} if malformed or the wrong curve
     */
    public PublicKey parsePublicKey(byte[] spki) {
        try {
            PublicKey key = KeyFactory.getInstance(keyAlgorithm).generatePublic(new X509EncodedKeySpec(spki));
            if (!(key instanceof ECPublicKey ec) || ec.getParams().getCurve().getField().getFieldSize() != fieldSize) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "device key has the wrong curve");
            }
            return key;
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "malformed device public key");
        }
    }

    /**
     * Verifies a signature. Malformed signatures verify as {@code false}, never throw.
     *
     * @param spki SPKI public key
     * @param data signed bytes
     * @param signature P1363 signature
     * @return verification result
     */
    public boolean verify(byte[] spki, byte[] data, byte[] signature) {
        try {
            Signature verifier = Signature.getInstance(signatureAlgorithm);
            verifier.initVerify(parsePublicKey(spki));
            verifier.update(data);
            return verifier.verify(signature);
        } catch (GeneralSecurityException | EnclaveException e) {
            return false;
        }
    }
}
