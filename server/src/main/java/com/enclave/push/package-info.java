/**
 * Push module (MSG-02): content-free wake-ups for devices that are offline, delivered through a
 * self-hosted UnifiedPush distributor (ntfy). The wake carries no sender, message or conversation;
 * the device connects and fetches its encrypted mailbox. Endpoints are restricted to allow-listed
 * distributor hosts so the server cannot be used to call arbitrary URLs.
 */
@org.springframework.modulith.ApplicationModule(displayName = "Push")
package com.enclave.push;
