/**
 * Calls module: authorizes audio/video calls and issues short-lived LiveKit room tokens. Media
 * flows through the self-hosted LiveKit SFU (and coturn for relay); media frames are end-to-end
 * encrypted with a key that clients exchange inside Signal/MLS messages, so neither LiveKit nor
 * this server can decrypt them. Ringing and call events are ordinary E2EE messages.
 */
@org.springframework.modulith.ApplicationModule(displayName = "Calls")
package com.enclave.calls;
