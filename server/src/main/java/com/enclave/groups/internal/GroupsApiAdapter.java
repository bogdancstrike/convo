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
    private final InviteService invites;
    private final GroupService service;
    GroupsApiAdapter(GroupRepository groups, InviteService invites, GroupService service) { this.groups = groups; this.invites = invites; this.service = service; }

    @Override
    public Counts counts() { return groups.counts(); }

    @Override
    public RemovalOutcome removeOnBehalf(byte[] groupId, UUID accountId) { return service.removeOnBehalf(groupId, accountId); }

    @Override
    @Transactional(readOnly = true)
    public Optional<GroupSummary> summary(byte[] groupId) {
        return groups.find(groupId).filter((g) -> !"deleted".equals(g.status())).map((g) -> {
            var roles = new java.util.HashMap<UUID, String>();
            groups.members(groupId).forEach((a, r) -> roles.put(a, r.db()));
            return new GroupSummary(java.util.Map.copyOf(roles), g.adminOnly());
        });
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.List<byte[]> groupsOf(UUID accountId) { return groups.groupIdsOf(accountId); }

    @Override
    @Transactional
    public void requestToJoin(byte[] groupId, UUID accountId) {
        invites.requestFor(groupId, accountId);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Set<UUID>> members(byte[] groupId) {
        return groups.find(groupId).filter((g) -> !"deleted".equals(g.status())).map((g) -> Set.copyOf(groups.members(groupId).keySet()));
    }
}
