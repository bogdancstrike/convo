package com.enclave.contracts;

import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;

/**
 * Ed25519 helpers shared by the server's signing keys (organization policy, key-transparency log):
 * PKCS#8 loading with a sign/verify self-check, raw 32-byte public keys for clients, and
 * verification of signatures by external keys (key-transparency witnesses).
 */
public final class Ed25519Keys {
    /** X.509 SubjectPublicKeyInfo prefix of an Ed25519 key (RFC 8410); the raw key follows. */
    private static final byte[] X509_PREFIX = {0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00};

    private Ed25519Keys() {}

    /** A fresh private key, PKCS#8-encoded (for storing a generated development key). */
    public static byte[] generatePkcs8() {
        try { return KeyPairGenerator.getInstance("Ed25519").generateKeyPair().getPrivate().getEncoded(); }
        catch (GeneralSecurityException e) { throw new IllegalStateException(e); }
    }

    /**
     * The key pair of a PKCS#8 private key. The JDK cannot derive an Ed25519 public key directly, so
     * it is regenerated from the 32-byte seed that ends the structure, then checked by a signature.
     *
     * @throws GeneralSecurityException when the bytes are not a usable Ed25519 key
     */
    public static KeyPair fromPkcs8(byte[] pkcs8) throws GeneralSecurityException {
        PrivateKey priv = KeyFactory.getInstance("Ed25519").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
        KeyPairGenerator generator = KeyPairGenerator.getInstance("Ed25519");
        generator.initialize(255, new FixedSeed(Arrays.copyOfRange(pkcs8, pkcs8.length - 32, pkcs8.length)));
        KeyPair pair = new KeyPair(generator.generateKeyPair().getPublic(), priv);
        byte[] probe = "ed25519-self-check".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (!verify(raw(pair.getPublic()), probe, sign(priv, probe))) throw new GeneralSecurityException("Ed25519 key pair does not match");
        return pair;
    }

    public static byte[] sign(PrivateKey key, byte[] message) {
        try {
            Signature signer = Signature.getInstance("Ed25519");
            signer.initSign(key); signer.update(message);
            return signer.sign();
        } catch (GeneralSecurityException e) { throw new IllegalStateException(e); }
    }

    /** Verifies a signature by a raw 32-byte public key; false for malformed keys or signatures. */
    public static boolean verify(byte[] rawPublicKey, byte[] message, byte[] signature) {
        if (rawPublicKey == null || rawPublicKey.length != 32 || signature == null || signature.length != 64) return false;
        try {
            byte[] encoded = Arrays.copyOf(X509_PREFIX, X509_PREFIX.length + 32);
            System.arraycopy(rawPublicKey, 0, encoded, X509_PREFIX.length, 32);
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(encoded)));
            verifier.update(message);
            return verifier.verify(signature);
        } catch (GeneralSecurityException e) { return false; }
    }

    /** The raw 32-byte public key (the end of its X.509 encoding). */
    public static byte[] raw(PublicKey key) {
        byte[] encoded = key.getEncoded();
        return Arrays.copyOfRange(encoded, encoded.length - 32, encoded.length);
    }

    /** SecureRandom that returns a fixed seed, used only to re-derive a public key. */
    private static final class FixedSeed extends SecureRandom {
        private final byte[] seed;
        FixedSeed(byte[] seed) { this.seed = seed.clone(); }
        @Override public void nextBytes(byte[] bytes) { System.arraycopy(seed, 0, bytes, 0, Math.min(seed.length, bytes.length)); }
    }
}
