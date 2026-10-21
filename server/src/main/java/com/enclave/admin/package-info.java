/**
 * Admin module (ADM-01): organization-administrator operations on accounts and devices behind the
 * {@code convo-admin} realm role, with a hash-chained audit log. It never reads chat content,
 * keys or archives, and cannot add anyone to a conversation.
 */
@org.springframework.modulith.ApplicationModule(displayName = "Administration")
package com.enclave.admin;
