package com.enclave.identity.internal.keys;

/**
 * Per-device bundle returned by a claim (specs §5.1).
 *
 * @param deviceId device number
 * @param registrationId Signal registration ID
 * @param signedPreKey current signed prekey
 * @param oneTimePreKey consumed one-time prekey, or {@code null} when exhausted
 */
public record PreKeyBundle(int deviceId, int registrationId, SignedPreKey signedPreKey, OneTimePreKey oneTimePreKey) {}
