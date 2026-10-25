package com.enclave.communities.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.groups.GroupsApi;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Community use cases (specs §30.3). Authority comes from the MLS groups' mirrored roles: the root
 * group's owners/admins manage the community; each subgroup's owner decides about its own link.
 * Outsiders get NOT_FOUND so community IDs reveal nothing.
 */
@Service
class CommunityService {
    /** Max linked/proposed groups per community (bounded fan-out and listing). */
    static final int MAX_LINKS = 50;

    record CommunityView(UUID communityId, String rootGroupId, String role, long version) {}
    record LinkView(String groupId, String visibility, String status, boolean member, boolean canAccept, long version, boolean delegation) {}
    record OperationView(String groupId, UUID accountId, String status, java.time.Instant updatedAt) {}

    private final CommunityRepository communities;
    private final GroupsApi groups;

    CommunityService(CommunityRepository communities, GroupsApi groups) {
        this.communities = communities;
        this.groups = groups;
    }

    /** The caller must own an admin-only (announcement) group that is not linked anywhere. */
    @Transactional
    CommunityView create(UUID caller, byte[] rootGroupId) {
        var root = groups.summary(rootGroupId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "group unavailable"));
        if (!root.isOwner(caller)) throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only the owner can make a group a community");
        if (!root.adminOnly()) throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "the root must be an announcement channel");
        if (communities.isRoot(rootGroupId) || communities.linkOf(rootGroupId).isPresent()) {
            throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "group already belongs to a community");
        }
        UUID id = UUID.randomUUID();
        communities.insert(id, rootGroupId, caller);
        return new CommunityView(id, hex(rootGroupId), "owner", 1);
    }

    @Transactional(readOnly = true)
    List<CommunityView> mine(UUID caller) {
        Set<String> member = groups.groupsOf(caller).stream().map(CommunityService::hex).collect(Collectors.toSet());
        List<CommunityView> out = new ArrayList<>();
        for (var c : communities.all()) {
            if (!member.contains(hex(c.rootGroupId()))) continue;
            String role = groups.summary(c.rootGroupId()).map((s) -> s.roles().get(caller)).orElse(null);
            if (role != null) out.add(new CommunityView(c.communityId(), hex(c.rootGroupId()), role, c.version()));
        }
        return out;
    }

    /**
     * Linked groups visible to the caller: active discoverable links for every community member;
     * private and proposed links only for root managers, the subgroup's members/owner.
     */
    @Transactional(readOnly = true)
    List<LinkView> groups(UUID caller, UUID communityId) {
        var community = memberCommunity(caller, communityId);
        boolean manager = groups.summary(community.rootGroupId()).map((s) -> s.isManager(caller)).orElse(false);
        List<LinkView> out = new ArrayList<>();
        for (var link : communities.links(communityId)) {
            var sub = groups.summary(link.groupId()).orElse(null);
            if (sub == null) continue;
            boolean member = sub.roles().containsKey(caller);
            boolean owner = sub.isOwner(caller);
            boolean visible = "active".equals(link.status()) && "discoverable".equals(link.visibility()) || manager || member;
            if (visible) out.add(new LinkView(hex(link.groupId()), link.visibility(), link.status(), member, owner && "proposed".equals(link.status()), link.version(), link.delegation()));
        }
        return out;
    }

    /** A community admin links (or proposes) a group; it is active at once only if they also own it. */
    @Transactional
    LinkView link(UUID caller, UUID communityId, byte[] groupId, String visibility, boolean delegation) {
        var community = memberCommunity(caller, communityId);
        if (!"discoverable".equals(visibility) && !"private".equals(visibility)) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "visibility");
        var root = groups.summary(community.rootGroupId()).orElseThrow();
        if (!root.isManager(caller)) throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only community admins can link groups");
        var sub = groups.summary(groupId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "group unavailable"));
        if (Arrays.equals(groupId, community.rootGroupId()) || communities.isRoot(groupId)) {
            throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "a community root cannot be linked as a group");
        }
        if (communities.linkOf(groupId).isPresent()) throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "group already has a community");
        if (communities.countLinks(communityId) >= MAX_LINKS) throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "too many linked groups");
        boolean accepted = sub.isOwner(caller);
        if (accepted) requireSubset(sub, root);
        // Only the group's owner can grant parent-removal delegation (here: the owner linking it).
        communities.propose(communityId, groupId, visibility, caller, accepted, delegation);
        return new LinkView(hex(groupId), visibility, accepted ? "active" : "proposed", sub.roles().containsKey(caller), !accepted && sub.isOwner(caller), 1, accepted && delegation);
    }

    /** The subgroup owner accepts a proposed link. */
    @Transactional
    void accept(UUID caller, UUID communityId, byte[] groupId, boolean delegation) {
        var community = communities.find(communityId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "community not found"));
        var link = communities.linkOf(groupId).filter((l) -> l.communityId().equals(communityId))
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "link not found"));
        var sub = groups.summary(groupId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "group unavailable"));
        if (!sub.isOwner(caller)) throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only the group owner can accept");
        if ("active".equals(link.status())) return;
        requireSubset(sub, groups.summary(community.rootGroupId()).orElseThrow());
        communities.accept(communityId, groupId, caller, delegation);
    }

    /** Either authority may detach: a community admin or the subgroup owner. */
    @Transactional
    void unlink(UUID caller, UUID communityId, byte[] groupId) {
        var community = communities.find(communityId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "community not found"));
        communities.linkOf(groupId).filter((l) -> l.communityId().equals(communityId))
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "link not found"));
        boolean rootManager = groups.summary(community.rootGroupId()).map((s) -> s.isManager(caller)).orElse(false);
        boolean subOwner = groups.summary(groupId).map((s) -> s.isOwner(caller)).orElse(false);
        if (!rootManager && !subOwner) throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "not allowed to unlink");
        communities.unlink(communityId, groupId);
    }

    /** A community member asks to join a discoverable linked group (an admin there approves). */
    @Transactional
    void requestJoin(UUID caller, UUID communityId, byte[] groupId) {
        memberCommunity(caller, communityId);
        var link = communities.linkOf(groupId).filter((l) -> l.communityId().equals(communityId) && "active".equals(l.status()) && "discoverable".equals(l.visibility()))
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "group not found"));
        groups.requestToJoin(link.groupId(), caller);
    }

    /** Membership operations of a community (root owners/admins). */
    @Transactional(readOnly = true)
    List<OperationView> operations(UUID caller, UUID communityId) {
        var community = memberCommunity(caller, communityId);
        if (!groups.summary(community.rootGroupId()).map((s) -> s.isManager(caller)).orElse(false)) {
            throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only community admins see operations");
        }
        return communities.operations(communityId).stream().map((o) -> new OperationView(hex(o.groupId()), o.accountId(), o.status(), o.updatedAt())).toList();
    }

    /**
     * Someone left or was removed from a community root: apply it to every linked group that
     * accepted parent-removal delegation. Pending until a member commits the MLS removal; a last
     * owner is never stranded (blocked until ownership is transferred).
     */
    @Transactional
    void onRootRemoval(byte[] rootGroupId, java.util.Set<UUID> accounts) {
        var community = communities.byRoot(rootGroupId).orElse(null);
        if (community == null) return;
        for (var link : communities.links(community.communityId())) {
            if (!"active".equals(link.status()) || !link.delegation()) continue;
            for (UUID account : accounts) {
                switch (groups.removeOnBehalf(link.groupId(), account)) {
                    case REMOVED -> communities.recordOperation(community.communityId(), link.groupId(), account, "pending");
                    case LAST_OWNER -> communities.recordOperation(community.communityId(), link.groupId(), account, "blocked");
                    case NOT_MEMBER -> { }
                }
            }
        }
    }

    /**
     * Re-evaluates removals that were blocked in a group because the removed account was its last
     * owner (§30.3): after an ownership transfer they become pending (then completed by the MLS
     * removal); an account that already left counts as completed.
     */
    @Transactional
    void retryBlocked(byte[] groupId) {
        for (var op : communities.blocked(groupId)) {
            switch (groups.removeOnBehalf(groupId, op.accountId())) {
                case REMOVED -> communities.recordOperation(op.communityId(), groupId, op.accountId(), "pending");
                case NOT_MEMBER -> communities.recordOperation(op.communityId(), groupId, op.accountId(), "completed");
                case LAST_OWNER -> { }
            }
        }
    }

    /** Community admins: retry every blocked removal of the community's linked groups now. */
    @Transactional
    int retryBlocked(UUID caller, UUID communityId) {
        var community = memberCommunity(caller, communityId);
        if (!groups.summary(community.rootGroupId()).map((s) -> s.isManager(caller)).orElse(false)) {
            throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only community admins retry operations");
        }
        int before = (int) communities.operations(communityId).stream().filter(o -> "blocked".equals(o.status())).count();
        communities.links(communityId).forEach(link -> retryBlocked(link.groupId()));
        int after = (int) communities.operations(communityId).stream().filter(o -> "blocked".equals(o.status())).count();
        return before - after;
    }

    /** A group's MLS removal commit was accepted: its pending operations are done. */
    @Transactional
    void onGroupRemovalCommitted(byte[] groupId, java.util.Set<UUID> accounts) {
        communities.completeOperations(groupId, accounts);
    }

    /** Linked subgroups' members must already be community members (specs §30.3, P0). */
    private static void requireSubset(GroupsApi.GroupSummary sub, GroupsApi.GroupSummary root) {
        if (!root.roles().keySet().containsAll(sub.roles().keySet())) {
            throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "every group member must join the community first");
        }
    }

    private CommunityRepository.Community memberCommunity(UUID caller, UUID communityId) {
        var community = communities.find(communityId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "community not found"));
        boolean member = groups.summary(community.rootGroupId()).map((s) -> s.roles().containsKey(caller)).orElse(false);
        if (!member) throw new EnclaveException(ErrorCode.NOT_FOUND, "community not found");
        return community;
    }

    static String hex(byte[] id) { return com.enclave.contracts.Base64Url.encode(id); }
}
