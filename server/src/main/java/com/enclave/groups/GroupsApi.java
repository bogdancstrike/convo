package com.enclave.groups;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Read-only group membership for other modules (e.g. call authorization). */
public interface GroupsApi {
    /**
     * @param groupId 32-byte MLS group ID
     * @return current member accounts, or empty when the group does not exist
     */
    Optional<Set<UUID>> members(byte[] groupId);
}
