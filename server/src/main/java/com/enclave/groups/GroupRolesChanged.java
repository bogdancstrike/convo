package com.enclave.groups;

/**
 * Published after a commit changed member roles in a group (e.g. ownership was transferred), so
 * work blocked on roles can be retried — such as a community removal waiting for a subgroup's last
 * owner to hand over ownership (specs §30.3).
 *
 * @param groupId 32-byte MLS group ID
 */
public record GroupRolesChanged(byte[] groupId) {}
