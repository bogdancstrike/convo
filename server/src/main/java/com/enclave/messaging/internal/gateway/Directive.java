package com.enclave.messaging.internal.gateway;

/**
 * Server-initiated directives (specs §9.2). Also used as the content of {@code ctl:*} hints.
 * Hints never authorize destructive client actions; a client re-validates via authenticated APIs.
 */
public enum Directive {
    /** One-time prekeys are running low; upload more. */
    KEYS_LOW,
    /** The account's device list changed; refresh own devices / rosters. */
    DEVICE_LIST_CHANGED,
    /** Organization policy changed. */
    POLICY_UPDATED,
    /** The device was revoked; the gateway closes the socket with 4401. */
    REVOKED
}
