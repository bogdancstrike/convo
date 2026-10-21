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
 * @param mlsRemoved true when an accepted MLS commit removed their leaves (cryptographic removal
 *     done); false when only the server ACL changed (leave, delegated removal) and a member's
 *     client still has to commit the removal
 */
public record GroupMembersRemoved(byte[] groupId, Set<UUID> accounts, boolean mlsRemoved) {

    /** ACL-only removal. */
    public GroupMembersRemoved(byte[] groupId, Set<UUID> accounts) {
        this(groupId, accounts, false);
    }
}
