package com.enclave.identity.internal.keys;

/**
 * Signal signed prekey (public part) and its identity-key signature.
 *
 * @param keyId client-assigned key ID
 * @param publicKey serialized Curve25519 public key
 * @param signature XEdDSA signature by the account identity key
 */
public record SignedPreKey(int keyId, byte[] publicKey, byte[] signature) {}
