/**
 * Key transparency module (specs §19.4, TRUST-01): an append-only verifiable log of every account's
 * identity key and device list, signed tree heads, inclusion and consistency proofs, and witness
 * co-signatures. Clients verify the keys they encrypt to against witnessed heads, monitor their own
 * entry and detect rollback or split views. Holds public keys and hashes only.
 */
@org.springframework.modulith.ApplicationModule(displayName = "Key transparency")
package com.enclave.transparency;
