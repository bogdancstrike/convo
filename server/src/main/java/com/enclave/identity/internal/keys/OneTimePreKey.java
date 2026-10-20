package com.enclave.identity.internal.keys;

/**
 * Signal one-time prekey (public part). Consumed by exactly one claim.
 *
 * @param keyId client-assigned key ID
 * @param publicKey serialized Curve25519 public key
 */
public record OneTimePreKey(int keyId, byte[] publicKey) {}
