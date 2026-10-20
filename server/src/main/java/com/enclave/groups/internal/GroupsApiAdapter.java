package com.enclave.groups.internal;

import com.enclave.groups.GroupsApi;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** {@link GroupsApi} backed by the server's role ACL mirror. */
@Component
class GroupsApiAdapter implements GroupsApi {
    private final GroupRepository groups;
    GroupsApiAdapter(GroupRepository groups) { this.groups = groups; }

    @Override
    @Transactional(readOnly = true)
    public Optional<Set<UUID>> members(byte[] groupId) {
        return groups.find(groupId).filter((g) -> !"deleted".equals(g.status())).map((g) -> Set.copyOf(groups.members(groupId).keySet()));
    }
}
