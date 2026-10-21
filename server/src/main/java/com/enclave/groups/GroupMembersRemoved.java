package com.enclave.groups;

import java.util.Set;
import java.util.UUID;

/**
 * Published (after commit) when accounts stop being members of a group: removed by an admin,
 * banned, or left. Other modules revoke what membership granted, e.g. calls removes them from an
 * ongoing group call.
 *
 * @param groupId 32-byte MLS group ID
 * @param accounts accounts that are no longer members
 */
public record GroupMembersRemoved(byte[] groupId, Set<UUID> accounts) {}
