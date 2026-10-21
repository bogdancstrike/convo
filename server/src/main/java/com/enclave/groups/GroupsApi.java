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

    /**
     * Roles and posting policy (for linkage authority checks).
     *
     * @return empty when the group does not exist
     */
    Optional<GroupSummary> summary(byte[] groupId);

    /**
     * Files a join request for an account, as if through an invite link: banned accounts get
     * NOT_FOUND, members are a no-op, pending requests are capped. Grants nothing by itself.
     */
    void requestToJoin(byte[] groupId, UUID accountId);

    /** Result of {@link #removeOnBehalf}. */
    enum RemovalOutcome { REMOVED, NOT_MEMBER, LAST_OWNER }

    /**
     * Removes an account as if it had left (delegated community removal): fan-out stops now; a
     * member's client commits the MLS removal. A last owner with other members is not removed.
     */
    RemovalOutcome removeOnBehalf(byte[] groupId, UUID accountId);

    /** Groups (32-byte IDs) the account is a member of. */
    java.util.List<byte[]> groupsOf(UUID accountId);

    /**
     * @param roles member account → {@code owner}/{@code admin}/{@code member}
     * @param adminOnly only owners/admins may post (announcement channels)
     */
    record GroupSummary(java.util.Map<UUID, String> roles, boolean adminOnly) {
        public boolean isManager(UUID account) { String r = roles.get(account); return "owner".equals(r) || "admin".equals(r); }
        public boolean isOwner(UUID account) { return "owner".equals(roles.get(account)); }
    }

    /**
     * Totals for operators (counts only).
     *
     * @param groups active discussion groups
     * @param channels active admin-only groups (channels, community announcement feeds)
     */
    record Counts(long groups, long channels) {}

    Counts counts();
}
