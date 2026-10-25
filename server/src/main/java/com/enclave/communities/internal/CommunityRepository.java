package com.enclave.communities.internal;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for {@code communities} and {@code community_group_links}. */
@Repository
class CommunityRepository {
    record Community(UUID communityId, byte[] rootGroupId, long version) {}
    record Link(UUID communityId, byte[] groupId, String visibility, String status, UUID proposedBy, long version, boolean delegation) {}
    record Operation(byte[] groupId, UUID accountId, String status, java.time.Instant updatedAt) {}

    private final JdbcClient jdbc;
    CommunityRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    void insert(UUID id, byte[] rootGroupId, UUID createdBy) {
        jdbc.sql("INSERT INTO communities (community_id, root_group_id, created_by) VALUES (:id, :g, :by)")
                .param("id", id).param("g", rootGroupId).param("by", createdBy).update();
    }

    Optional<Community> find(UUID id) {
        return jdbc.sql("SELECT community_id, root_group_id, version FROM communities WHERE community_id = :id").param("id", id)
                .query((rs, i) -> new Community(rs.getObject(1, UUID.class), rs.getBytes(2), rs.getLong(3))).optional();
    }

    List<Community> all() {
        return jdbc.sql("SELECT community_id, root_group_id, version FROM communities ORDER BY created_at")
                .query((rs, i) -> new Community(rs.getObject(1, UUID.class), rs.getBytes(2), rs.getLong(3))).list();
    }

    boolean isRoot(byte[] groupId) {
        return jdbc.sql("SELECT count(*) FROM communities WHERE root_group_id = :g").param("g", groupId).query(Long.class).single() > 0;
    }

    Optional<Link> linkOf(byte[] groupId) {
        return jdbc.sql("SELECT community_id, group_id, visibility, status, proposed_by, version, delegation FROM community_group_links WHERE group_id = :g")
                .param("g", groupId).query(CommunityRepository::link).optional();
    }

    List<Link> links(UUID communityId) {
        return jdbc.sql("SELECT community_id, group_id, visibility, status, proposed_by, version, delegation FROM community_group_links WHERE community_id = :c ORDER BY updated_at")
                .param("c", communityId).query(CommunityRepository::link).list();
    }

    long countLinks(UUID communityId) {
        return jdbc.sql("SELECT count(*) FROM community_group_links WHERE community_id = :c").param("c", communityId).query(Long.class).single();
    }

    void propose(UUID communityId, byte[] groupId, String visibility, UUID by, boolean accepted, boolean delegation) {
        jdbc.sql("""
                INSERT INTO community_group_links (community_id, group_id, visibility, status, proposed_by, accepted_by, delegation)
                VALUES (:c, :g, :v, :s, :by, :acc, :d)""")
                .param("c", communityId).param("g", groupId).param("v", visibility).param("s", accepted ? "active" : "proposed")
                .param("by", by).param("acc", accepted ? by : null).param("d", accepted && delegation).update();
        bump(communityId);
    }

    void accept(UUID communityId, byte[] groupId, UUID by, boolean delegation) {
        jdbc.sql("UPDATE community_group_links SET status = 'active', accepted_by = :by, delegation = :d, version = version + 1, updated_at = now() WHERE community_id = :c AND group_id = :g")
                .param("c", communityId).param("g", groupId).param("by", by).param("d", delegation).update();
        bump(communityId);
    }

    void unlink(UUID communityId, byte[] groupId) {
        jdbc.sql("DELETE FROM community_group_links WHERE community_id = :c AND group_id = :g").param("c", communityId).param("g", groupId).update();
        bump(communityId);
    }

    Optional<Community> byRoot(byte[] rootGroupId) {
        return jdbc.sql("SELECT community_id, root_group_id, version FROM communities WHERE root_group_id = :g").param("g", rootGroupId)
                .query((rs, i) -> new Community(rs.getObject(1, UUID.class), rs.getBytes(2), rs.getLong(3))).optional();
    }

    void recordOperation(UUID communityId, byte[] groupId, UUID account, String status) {
        jdbc.sql("""
                INSERT INTO community_membership_ops (community_id, group_id, account_id, status) VALUES (:c, :g, :a, :s)
                ON CONFLICT (community_id, group_id, account_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()""")
                .param("c", communityId).param("g", groupId).param("a", account).param("s", status).update();
    }

    /** A removal blocked in a group (the account is its last owner), with its community. */
    record BlockedOperation(UUID communityId, UUID accountId) {}

    List<BlockedOperation> blocked(byte[] groupId) {
        return jdbc.sql("SELECT community_id, account_id FROM community_membership_ops WHERE group_id = :g AND status = 'blocked'").param("g", groupId)
                .query((rs, i) -> new BlockedOperation(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class))).list();
    }

    /** Pending operations become completed once the group's MLS removal commit was accepted. */
    int completeOperations(byte[] groupId, java.util.Collection<UUID> accounts) {
        int n = 0;
        for (UUID a : accounts) n += jdbc.sql("UPDATE community_membership_ops SET status = 'completed', updated_at = now() WHERE group_id = :g AND account_id = :a AND status = 'pending'")
                .param("g", groupId).param("a", a).update();
        return n;
    }

    List<Operation> operations(UUID communityId) {
        return jdbc.sql("SELECT group_id, account_id, status, updated_at FROM community_membership_ops WHERE community_id = :c ORDER BY updated_at DESC LIMIT 200")
                .param("c", communityId)
                .query((rs, i) -> new Operation(rs.getBytes(1), rs.getObject(2, UUID.class), rs.getString(3), rs.getTimestamp(4).toInstant())).list();
    }

    private void bump(UUID communityId) {
        jdbc.sql("UPDATE communities SET version = version + 1 WHERE community_id = :c").param("c", communityId).update();
    }

    private static Link link(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Link(rs.getObject(1, UUID.class), rs.getBytes(2), rs.getString(3), rs.getString(4), rs.getObject(5, UUID.class), rs.getLong(6), rs.getBoolean(7));
    }
}
