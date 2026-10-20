/**
 * Groups module: MLS Delivery Service. Orders commits per group, mirrors the role ACL and device
 * routing roster, and fans out MLS ciphertext. Never holds group secrets.
 */
@org.springframework.modulith.ApplicationModule(displayName = "Groups")
package com.enclave.groups;
