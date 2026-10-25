package com.enclave.communities.internal;

import com.enclave.groups.GroupMembersRemoved;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Component;

/**
 * Applies community removal to linked groups that accepted parent-removal delegation, and marks
 * those operations complete once the group's MLS removal commit is accepted (specs §30.3).
 * Persistent module listener: retried after a crash between commit and handling.
 */
@Component
class CommunityRemovalListener {
    private final CommunityService communities;
    CommunityRemovalListener(CommunityService communities) { this.communities = communities; }

    /** Ownership or roles changed in a group: retry community removals that were blocked there. */
    @ApplicationModuleListener
    void on(com.enclave.groups.GroupRolesChanged event) {
        communities.retryBlocked(event.groupId());
    }

    @ApplicationModuleListener
    void on(GroupMembersRemoved event) {
        communities.onRootRemoval(event.groupId(), event.accounts());
        if (event.mlsRemoved()) communities.onGroupRemovalCommitted(event.groupId(), event.accounts());
    }
}
